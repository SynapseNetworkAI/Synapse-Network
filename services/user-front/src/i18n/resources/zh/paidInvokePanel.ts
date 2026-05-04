import type { I18nMessages } from "@/i18n/schema";

const paidInvokePanel: I18nMessages["paidInvokePanel"] = {
  missingConfig: "请先补齐 endpoint、service ID 和 pricing。",
  inactiveService: "服务当前未激活。测试前请先切换为 Active。",
  completed: "付费调用已完成。",
  failed: "调用失败",
  txHash: "交易哈希",
  attempts: "重试次数",
  testPrompt: "测试 Prompt",
  processing: "处理中...",
  payAndInvoke: "支付并调用",
  unavailableHint: "Endpoint / Service ID / pricing 缺失，或服务当前未激活。",
  defaultTitle: "实时测试（支付 + 调用）",
  collapse: "收起",
  expand: "展开",
  collapsedHint: "点击展开，运行一次付费服务调用测试。",
  defaultPrompt: "hello from agent",
};

export default paidInvokePanel;
