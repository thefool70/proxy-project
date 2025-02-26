/**
 * 代理服务器实现：
 * - 所有请求发至 /proxy 后会被依次排队，只有上一个请求完成后才会处理下一个请求
 * - 非流式版本：整个响应数据获取完成后，再返回给客户端
 * - 对请求头和请求体进行过滤，仅保留目标 API 所需的部分字段
 */
const express = require('express');
const axios = require('axios');
const app = express();

// 解析 JSON 请求体
app.use(express.json());

// 大模型 API 地址，可通过环境变量 MODEL_API_ENDPOINT 进行配置
const MODEL_API_ENDPOINT = process.env.MODEL_API_ENDPOINT || 'https://chat01.ai/v1/chat/completions';

// 允许转发的请求头列表
const allowedHeaders = ['content-type', 'accept', 'authorization'];

// 请求队列及处理标记
let queue = [];
let processing = false;

/**
 * 处理队列中的下一个请求
 */
function processQueue() {
  if (queue.length === 0) {
    processing = false;
    console.log('队列为空，等待新请求...');
    return;
  }
  processing = true;
  const { req, res } = queue.shift();
  console.log(`\n========== 开始处理请求 ==========\n当前队列长度：${queue.length}`);
  console.log(`转发请求到大模型 API：${MODEL_API_ENDPOINT}`);
  console.log(`请求方法：${req.method}`);

  // 过滤请求头，仅保留允许的字段
  const filteredHeaders = {};
  Object.keys(req.headers).forEach(key => {
    if (allowedHeaders.includes(key.toLowerCase())) {
      filteredHeaders[key] = req.headers[key];
    }
  });
  console.log('过滤后的请求头：', filteredHeaders);

  // 过滤请求体，移除不需要的字段，例如 stream
  const forwardBody = { ...req.body };
  if ('stream' in forwardBody) {
    console.log('检测到请求体中存在 "stream" 参数，已将其移除');
    delete forwardBody.stream;
  }
  console.log('转发的请求体：', forwardBody);

  axios({
  method: req.method,
  url: MODEL_API_ENDPOINT,
  data: forwardBody,
  headers: filteredHeaders
}).then(apiRes => {
  console.log(`\n从大模型 API 收到响应，状态码：${apiRes.status}`);
  console.log('响应头：', apiRes.headers);
  console.log('响应数据：', apiRes.data);
  
  // 将 AxiosHeaders 转为普通对象
  let responseHeaders = { ...apiRes.headers };
  // 删除可能冲突的头信息
  delete responseHeaders['transfer-encoding'];
  delete responseHeaders['content-length'];

  // 发送响应数据给客户端
  res.status(apiRes.status).set(responseHeaders).send(apiRes.data);
  console.log('响应数据已发送给客户端。');
  processQueue();
}).catch(err => {
  console.error('\n转发请求时发生错误：', err.toString());
  if (err.response) {
    console.error('错误响应状态码：', err.response.status);
    console.error('错误响应头：', err.response.headers);
    console.error('错误响应数据：', err.response.data);
    res.status(err.response.status || 500).send(err.response.data);
  } else {
    res.status(500).send(err.toString());
  }
  processQueue();
});
}

// 所有 /proxy 路由的请求都加入队列处理
app.all('/proxy', (req, res) => {
  console.log(`\n收到来自 ${req.ip} 的 ${req.method} 请求。`);
  queue.push({ req, res });
  console.log(`请求已加入队列，总队列数：${queue.length}`);
  if (!processing) {
    processQueue();
  }
});

// Render 部署时会通过环境变量 PORT 指定端口（默认 3000）
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n代理服务器启动，监听端口 ${PORT}`);
});
