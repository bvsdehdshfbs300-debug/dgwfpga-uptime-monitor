const SITE_URL = process.env.SITE_URL || 'https://dgwfpga.cn';
const SENDKEY = process.env.SERVERCHAN_SENDKEY || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REPOSITORY = process.env.GITHUB_REPOSITORY || '';
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE_NOTIFY = process.env.FORCE_NOTIFY === 'true';
const STATE_TITLE = '[monitor-state] dgwfpga.cn';
const TIME_ZONE = 'Asia/Shanghai';

const endpoints = [
  { name: '首页', url: `${SITE_URL}/`, validate: (body) => body.includes('<div id="root">') },
  { name: '练习后端', url: `${SITE_URL}/api/health`, validate: validateHealth },
];

function validateHealth(body) {
  try {
    const data = JSON.parse(body);
    return data.docker === true && data.image_ready === true && Number(data.levels) > 0;
  } catch {
    return false;
  }
}

function nowInChina() {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkEndpoint(endpoint) {
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(endpoint.url, {
      headers: {
        'cache-control': 'no-cache',
        'user-agent': 'dgwfpga-uptime-monitor/1.0',
      },
    });
    const body = await response.text();
    const valid = response.ok && endpoint.validate(body);
    return {
      name: endpoint.name,
      url: endpoint.url,
      ok: valid,
      status: response.status,
      elapsedMs: Date.now() - started,
      detail: valid ? '正常' : response.ok ? '响应内容不符合预期' : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name: endpoint.name,
      url: endpoint.url,
      ok: false,
      status: 0,
      elapsedMs: Date.now() - started,
      detail: error.name === 'AbortError' ? '请求超时' : error.message,
    };
  }
}

async function runRound(round) {
  const results = await Promise.all(endpoints.map(checkEndpoint));
  console.log(`检查第 ${round} 轮：`);
  for (const result of results) {
    console.log(`- ${result.name}: ${result.ok ? '正常' : '失败'} (${result.status || result.detail}, ${result.elapsedMs} ms)`);
  }
  return results;
}

function githubHeaders() {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${GITHUB_TOKEN}`,
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
    'user-agent': 'dgwfpga-uptime-monitor/1.0',
  };
}

async function githubRequest(path, options = {}) {
  const response = await fetchWithTimeout(`https://api.github.com${path}`, {
    ...options,
    headers: githubHeaders(),
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

function defaultState() {
  return {
    status: 'unknown',
    changedAt: null,
    checkedAt: null,
    lastFailure: null,
  };
}

function stateBody(state) {
  return [
    '此 Issue 由网站监控自动维护，请勿手动编辑。',
    '',
    '```json',
    JSON.stringify(state, null, 2),
    '```',
  ].join('\n');
}

function parseState(body) {
  const match = body?.match(/```json\s*([\s\S]*?)\s*```/i);
  if (!match) return defaultState();
  try {
    return { ...defaultState(), ...JSON.parse(match[1]) };
  } catch {
    return defaultState();
  }
}

async function loadState() {
  if (DRY_RUN || !GITHUB_TOKEN || !REPOSITORY) return { issue: null, state: defaultState() };
  const issues = await githubRequest(`/repos/${REPOSITORY}/issues?state=open&per_page=100`);
  const issue = issues.find((item) => !item.pull_request && item.title === STATE_TITLE);
  return { issue: issue || null, state: issue ? parseState(issue.body) : defaultState() };
}

async function saveState(issue, state) {
  if (DRY_RUN || !GITHUB_TOKEN || !REPOSITORY) return;
  const body = JSON.stringify({ title: STATE_TITLE, body: stateBody(state) });
  if (issue) {
    await githubRequest(`/repos/${REPOSITORY}/issues/${issue.number}`, { method: 'PATCH', body });
  } else {
    await githubRequest(`/repos/${REPOSITORY}/issues`, { method: 'POST', body });
  }
}

async function sendWechat(title, description) {
  if (!SENDKEY) {
    console.log('SERVERCHAN_SENDKEY 未配置，跳过微信通知。');
    return false;
  }
  const form = new URLSearchParams({ title, desp: description });
  const response = await fetchWithTimeout(`https://sctapi.ftqq.com/${encodeURIComponent(SENDKEY)}.send`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: form,
  });
  const result = await response.json();
  if (!response.ok || result.code !== 0) {
    throw new Error(`Server酱通知失败：${JSON.stringify(result)}`);
  }
  console.log('微信通知已发送。');
  return true;
}

function failureSummary(results) {
  return results
    .filter((result) => !result.ok)
    .map((result) => `- ${result.name}：${result.detail}`)
    .join('\n');
}

async function main() {
  const firstRound = await runRound(1);
  let finalResults = firstRound;
  if (firstRound.some((result) => !result.ok)) {
    console.log('发现异常，15 秒后复查。');
    await sleep(15000);
    finalResults = await runRound(2);
  }

  const isUp = finalResults.every((result) => result.ok);
  const currentStatus = isUp ? 'up' : 'down';
  const checkedAt = nowInChina();
  const { issue, state } = await loadState();
  const changed = state.status !== currentStatus;
  const previousStatus = state.status;

  if (currentStatus === 'down' && (changed || FORCE_NOTIFY)) {
    const summary = failureSummary(finalResults);
    await sendWechat(
      '地瓜丸 FPGA 教学平台疑似离线',
      `**状态：公网访问失败**\n\n${summary}\n\n- 网址：${SITE_URL}\n- 发现时间：${checkedAt}\n- 已连续复查：2 次\n\n可能原因：电脑关机、家庭网络断开、练习 API 或 Cloudflare Tunnel 停止。`,
    );
  } else if (currentStatus === 'up' && ((changed && previousStatus === 'down') || FORCE_NOTIFY)) {
    await sendWechat(
      '地瓜丸 FPGA 教学平台已恢复',
      `**状态：公网访问正常**\n\n- 网址：${SITE_URL}\n- 恢复时间：${checkedAt}\n- 首页与练习后端均已通过检查。`,
    );
  } else if (currentStatus === 'up' && previousStatus === 'unknown' && SENDKEY) {
    await sendWechat(
      '地瓜丸 FPGA 网站监控已启用',
      `监控配置成功。\n\n- 网址：${SITE_URL}\n- 首次检查：${checkedAt}\n- 首页与练习后端均正常。\n\n后续仅在离线或恢复时通知。`,
    );
  }

  const nextState = {
    status: currentStatus,
    changedAt: changed ? checkedAt : state.changedAt,
    checkedAt,
    lastFailure: isUp ? state.lastFailure : failureSummary(finalResults),
  };
  await saveState(issue, nextState);
  console.log(`最终状态：${currentStatus}`);
  if (!isUp) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

