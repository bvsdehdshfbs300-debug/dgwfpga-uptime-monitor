const sendKey = process.env.SERVERCHAN_SENDKEY || '';
const status = process.env.REPAIR_STATUS || 'unknown';
const summary = (process.env.REPAIR_SUMMARY || 'No repair details were received.').slice(0, 1800);
const checkedAt = process.env.REPAIR_CHECKED_AT || 'unknown';

if (!sendKey) {
  throw new Error('SERVERCHAN_SENDKEY is not configured.');
}

const titles = {
  recovered: '地瓜丸 FPGA 网站已自动修复',
  failed: '地瓜丸 FPGA 网站自动修复失败',
  test: '地瓜丸 FPGA 自动修复已启用',
};
const title = titles[status] || '地瓜丸 FPGA 网站修复报告';
const body = [
  status === 'recovered'
    ? '**结果：网站已经恢复访问**'
    : status === 'failed'
      ? '**结果：自动修复后仍无法访问，需要人工检查**'
      : '**本机自动修复守护程序已经启用**',
  '',
  `- 时间：${checkedAt}`,
  '- 网站：https://dgwfpga.cn',
  '',
  '```text',
  summary,
  '```',
].join('\n');

const form = new URLSearchParams({ title, desp: body });
const response = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(sendKey)}.send`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
  body: form,
});
const result = await response.json();
if (!response.ok || result.code !== 0) {
  throw new Error(`ServerChan rejected the repair report: ${JSON.stringify(result)}`);
}
console.log(`Repair report sent: ${status}`);
