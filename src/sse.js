// [复用模块] SSE 流式响应工具：统一 text/event-stream 的响应头、事件写入与生命周期。
// 用法：app.post(..., wrap(async (req, res) => runSSE(res, async (send) => { ... send('segment', {...}) })))
// runSSE 会自动在 handler 成功后补发 done、异常时补发 error，并最终 res.end()。

/**
 * 初始化一个 SSE 响应，返回 send(event, data) 写事件的函数。
 * @param {import('express').Response} res
 * @returns {(event: string, data: any) => void}
 */
export function openSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  return (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

/**
 * 运行一次 SSE 会话：打开流 → 交给 handler 推事件 → 收尾 done/error/end。
 * @param {import('express').Response} res
 * @param {(send: (event: string, data: any) => void) => Promise<void>} handler
 */
export async function runSSE(res, handler) {
  const send = openSSE(res);
  try {
    await handler(send);
    send('done', {});
  } catch (err) {
    console.error(err);
    send('error', { error: err.message });
  } finally {
    res.end();
  }
}
