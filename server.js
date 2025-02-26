/**
 * 代理服务器实现：
 * - 所有请求发至 /proxy 后会被依次排队，只有上一个请求完成后才会处理下一个请求
 * - 根据请求体中的 "stream" 参数决定是否启用流式转发：
 *    - 如果 "stream" 为 true，则（删除该参数）使用流式方式获取并转发 API 响应
 *    - 否则使用非流式方式，一次性获取完整响应后再发送给客户端
 * - 无论流式与否，都在请求正式发出前至少等待2秒，并在等待期间每隔5秒以文本流方式向客户端输出排队提示
 * - 整个响应都以 text/plain 进行输出，避免混合排队提示与 JSON 导致的解析错误
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

  // 根据请求体中的 stream 参数判断是否启用流式转发
  let useStream = false;
  const forwardBody = { ...req.body };
  if (forwardBody.stream === true) {
    useStream = true;
  }
  if ('stream' in forwardBody) {
    console.log('检测到请求体中存在 "stream" 参数，已将其移除');
    delete forwardBody.stream;
  }
  console.log('转发的请求体：', forwardBody);
  
  // 设置响应头：text/plain (分块传输)，保证可以持续写入排队提示
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });

  // 启动等待提示定时器：每隔5秒发送一次排队信息
  const waitingInterval = setInterval(() => {
    console.log('发送排队中提示给客户端');
    res.write("排队中，请稍后...\n");
  }, 5000);

  // 至少等待2秒后再开始请求目标API
  setTimeout(() => {
    clearInterval(waitingInterval);
    res.write("\n--- 开始返回数据 ---\n");

    if (useStream) {
      // 1) 流式请求处理
      axios({
        method: req.method,
        url: MODEL_API_ENDPOINT,
        data: forwardBody,
        headers: filteredHeaders,
        responseType: 'stream'
      })
        .then(apiRes => {
          console.log(`[流式] 收到大模型 API 响应，状态码：${apiRes.status}`);
          // 将 API 响应流直接pipe给客户端
          apiRes.data.pipe(res);
          apiRes.data.on('end', () => {
            console.log("API响应流结束");
            res.end();
            processQueue();
          });
          apiRes.data.on('error', err => {
            console.error("API响应流出错：", err);
            res.write("\nAPI响应流发生错误\n");
            res.end();
            processQueue();
          });
        })
        .catch(err => {
          console.error("转发请求时发生错误：", err.toString());
          if (err.response) {
            console.error('错误响应状态码：', err.response.status);
            console.error('错误响应数据：', err.response.data);
            res.write("转发请求时发生错误：" + JSON.stringify(err.response.data));
          } else {
            res.write("转发请求时发生错误：" + err.toString());
          }
          res.end();
          processQueue();
        });
    } else {
      // 2) 非流式请求处理
      axios({
        method: req.method,
        url: MODEL_API_ENDPOINT,
        data: forwardBody,
        headers: filteredHeaders
      })
        .then(apiRes => {
          console.log(`[非流式] 收到大模型 API 响应，状态码：${apiRes.status}`);
          let dataStr = '';
          // 确保将响应转换为字符串（可能是对象或字符串）
          if (typeof apiRes.data === 'object') {
            dataStr = JSON.stringify(apiRes.data, null, 2);
          } else {
            dataStr = String(apiRes.data);
          }
          // 将结果写到客户端
          res.write(dataStr);
          res.end();
          console.log('非流式响应数据已发送给客户端。');
          processQueue();
        })
        .catch(err => {
          console.error("转发请求时发生错误：", err.toString());
          if (err.response) {
            console.error('错误响应状态码：', err.response.status);
            console.error('错误响应数据：', err.response.data);
            res.write("转发请求时发生错误：" + JSON.stringify(err.response.data));
          } else {
            res.write("转发请求时发生错误：" + err.toString());
          }
          res.end();
          processQueue();
        });
    }
  }, 2000);
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
