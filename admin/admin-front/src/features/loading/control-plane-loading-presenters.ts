export type ControlPlaneSignal = {
  label: string;
  value: string;
  tone: "cyan" | "green" | "amber";
};

export function buildControlPlaneSignals(message: string): ControlPlaneSignal[] {
  const lowerCaseMessage = message.toLowerCase();

  return [
    {
      label: "Auth Tunnel",
      value: lowerCaseMessage.includes("连接") ? "linking" : "validated",
      tone: "cyan",
    },
    {
      label: "Projection Mesh",
      value: lowerCaseMessage.includes("同步") ? "syncing" : "warming",
      tone: "green",
    },
    {
      label: "Operator Context",
      value: lowerCaseMessage.includes("读取") || lowerCaseMessage.includes("检索") ? "hydrating" : "staging",
      tone: "amber",
    },
  ];
}