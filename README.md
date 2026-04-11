# Seabay AI Logistics Demo

为 `Seabay 国际物流 AI 自动化岗位` 定制的移动端优先 demo。

项目目标不是重做企业官网，而是把岗位职责直接做成一个可演示的内部工作台：

- `智能录单`：上传或拍照导入单据，调用 OCR，抽取字段，生成订单草稿，并给出关键字段风险告警
- `智能报价`：导入价格表，生成多档报价方案，再进入方案详情与询价核价
- `智能询价`：导入联系人表，向企业微信发送询价消息，接收手机回复并解析回显

线上地址：

- `https://aqsk.top/seabay-ai-logistics-demo/`

## 当前状态

- 前端：`Vite + React + TypeScript + React Router`
- 后端：轻量 Flask 服务，负责 OCR、记录、RFQ live API
- 企业微信：已接通询价发送与回信解析链路
- 设计方向：`移动端友好 / 内部控制台 / 演示步骤尽量少`

## 页面结构

- `/intake`
  - 两按钮入口：拍照录单、导入图片/PDF
  - OCR 结果弹窗
  - 关键字段风险与订单草稿
- `/quote`
  - 导入价格表
  - 生成报价
  - 第一层弹窗：方案选择
  - 第二层弹窗：方案详情并转入询价核价
- `/procurement`
  - 导入联系人表
  - 发送企业微信询价
  - 询价控制台展示发送内容、手机回复原文、解析结果

## 本地运行

```bash
cd /root/dev/seabay-ai-logistics-demo
pnpm install
pnpm dev
```

生产构建：

```bash
pnpm build
```

## 目录说明

- `src/pages`
  - 3 个主页面：录单、报价、询价
- `src/context/DemoContext.tsx`
  - 页面共享状态、导入动作、报价与询价主流程
- `server/ocr_service.py`
  - OCR API、导入记录、RFQ live API
- `public/demo-assets`
  - 演示用 PDF、价格表、联系人表
- `generated-docs`
  - 额外生成的 demo 单据

## 演示资源

可直接导入的样例文件在 `public/demo-assets`：

- 单据
  - `commercial-invoice-pacific-home-supplies.pdf`
  - `packing-list-pacific-home-supplies.pdf`
  - `draft-bill-of-lading-pacific-home-supplies.pdf`
  - `commercial-invoice-key-fields-occluded.pdf`
- 价格表
  - `ocean-fcl-uswc-rate-sheet-apr-2026.csv`
  - `air-eu-westbound-rate-sheet-apr-2026.csv`
- 联系人表
  - `uswc-rfq-contact-book-apr-2026.csv`
  - `eu-air-rfq-contact-book-apr-2026.csv`

## 演示建议流程

1. 在 `录单` 上传或拍照导入单据，展示 OCR 和风险告警
2. 跳到 `报价`，生成报价并选择一个方案
3. 查看方案详情，点击 `转入询价核价`
4. 在 `询价` 导入联系人表并发送企业微信询价
5. 用手机回复价格，展示回信解析结果

## 已实现的真实能力

- 企业微信询价消息真实发送
- 手机端回复真实回流
- 报价格式最小解析：
  - `USD`
  - `时效`
  - `free days`
  - `validity`
- OCR 风险分层：
  - OCR 质量问题
  - 关键字段业务风险

## 当前边界

- 这是面试 demo，不是生产系统
- OCR 适合清晰 PDF 和较清晰拍照件
- 报价与联系人仍以本地 demo 数据为主
- 企业微信回复模式支持隐藏退出，但页面和文案不主动展示
- ZeroClaw 的真实下游 Agent 调用未接入本仓库，只保留了工作流位置

## 相关说明

- 项目仓库：`https://github.com/Ruler4396/seabay-ai-logistics-demo`
- `v1` 冻结包与版本说明已保留在本机发布目录
