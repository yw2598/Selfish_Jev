# 连接 Jev 服务

网页「服务端点」支持四个队伍各自填写服务基础地址、模型名称和可选 Bearer API 密钥。Jev 服务需实现 `GET /v1/models` 与 `POST /v1/systemone`；普通 OpenAI Chat Completions 服务请填入 LLM 区域。

本项目默认仍是 `http://127.0.0.1:8108`，模型名 `kev-latest`。地址由 **Node 服务端** 访问；本机现有部署经 SSH 隧道接入 Jev-0.8B，已有连接与默认语言服务均保留。仓库不包含远端服务器的 SSH 访问权限，也不会在新机器上自动启动旧推理集群。

使用你自己的公开 Jev 地址时，直接在网页修改四队端点，无需 SSH。四队可以填写相同地址，也可以使用四个不同的服务。

使用 SSH 时，将 `ssh-connections.example.json` 复制为 `ssh-connections.json`，填写你有权限访问的主机、SSH 端口、用户名和远端 HTTP 端口；本地默认使用 `~/.ssh/id_ed25519`。该文件已被 Git 忽略。保持本地端口与网页端点一致，服务会复用已有隧道或建立并维护自己的隧道。

`KEV_MANAGED_SSH=0` 可禁用自动隧道；此时自行转发端口，或直接填写可达的 HTTP(S) 地址。

## Jev 协议

模型列表响应示例：

```json
{"models":[{"name":"kev-latest","run":"your-model-revision"}]}
```

`/v1/systemone` 接收 `model`、`state`、`questions.decision`，其中 `criteria` 包含当前候选标签（例如 `C00`、`C01`）。响应必须给每个标签返回有限、非负的概率，且总和大于零：

```json
{"answers":{"decision":{"probabilities":{"C00":0.7,"C01":0.3}}},"usage":{"input_tokens":120,"output_tokens":2}}
```

程序会归一化概率，再按固定种子采样。模型版本变化会按队伍检测；故障决策会记录并暂停模拟。检查连接仅读取模型列表，LLM 连接测试会发送一条简短 Chat Completions 请求。
