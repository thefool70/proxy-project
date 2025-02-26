/**
 * 代理服务器实现：
 * - 所有请求发至 /proxy 后会被依次排队，只有上一个请求完成后才会处理下一个请求
 * - 使用 axios 的 responseType: 'stream' 实现流式传输，将大模型 API 的响应实时返回给客户端
 */
const express = require('express');
const axios = require('axios');
const app = express();

// 解析 JSON 请求体
app.use(express.json());

// 大模型 API 地址，可通过环境变量 MODEL_API_ENDPOINT 进行配置
const MODEL_API_ENDPOINT = process.env.MODEL_API_ENDPOINT || 'http://localhost:8000/model';

// 请求队列及处理标记
let queue = [];
let processing = false;

// 处理队列中的下一个请求
function processQueue() {
  if (queue.length === 0) {
    processing = false;
    return;
  }
  processing = true;
  const { req, res } = queue.shift();

  axios({
    method: req.method,
    url: MODEL_API_ENDPOINT,
    data: req.body,
    responseType: 'stream',
    headers: req.headers
  }).then(apiRes => {
      // 将 API 的状态码和头信息传递给客户端
      res.writeHead(apiRes.status, apiRes.headers);
      // 流式传输数据
      apiRes.data.pipe(res);
      // 当流结束或发生错误时，处理队列中的下一个请求
      apiRes.data.on('end', processQueue);
      apiRes.data.on('error', processQueue);
  }).catch(err => {
      res.status(500).send(err.toString());
      processQueue();
  });
}

// 所有 /proxy 路由的请求都加入队列处理
app.all('/proxy', (req, res) => {
  queue.push({ req, res });
  if (!processing) {
    processQueue();
  }
});

// Render 部署时会通过环境变量 PORT 指定端口（默认 3000）
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('代理服务器启动，监听端口', PORT);
});
