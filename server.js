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
const MODEL_API_ENDPOINT = 'https://chat01.ai/v1/chat/completions';

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
  console.log(`开始处理请求，当前队列长度：${queue.length}`);
  console.log(`转发请求到大模型 API：${MODEL_API_ENDPOINT}`);

  axios({
    method: req.method,
    url: MODEL_API_ENDPOINT,
    data: req.body,
    responseType: 'stream',
    headers: req.headers
  }).then(apiRes => {
    console.log(`从大模型 API 收到响应，状态码：${apiRes.status}`);
    // 将 API 的状态码和头信息传递给客户端
    res.writeHead(apiRes.status, apiRes.headers);
    console.log('开始流式传输响应数据...');
    // 流式传输数据
    apiRes.data.pipe(res);
    // 流结束时处理队列中的下一个请求
    apiRes.data.on('end', () => {
      console.log('响应流传输完毕。');
      processQueue();
    });
    // 流错误时也处理队列
    apiRes.data.on('error', (err) => {
      console.error('响应流传输发生错误：', err);
      processQueue();
    });
  }).catch(err => {
    console.error('转发请求时发生错误：', err.toString());
    res.status(500).send(err.toString());
    processQueue();
  });
}

// 所有 /proxy 路由的请求都加入队列处理
app.all('/proxy', (req, res) => {
  console.log(`收到来自 ${req.ip} 的 ${req.method} 请求。`);
  queue.push({ req, res });
  console.log(`请求已加入队列，总队列数：${queue.length}`);
  if (!processing) {
    processQueue();
  }
});

// Render 部署时会通过环境变量 PORT 指定端口（默认 3000）
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`代理服务器启动，监听端口 ${PORT}`);
});
