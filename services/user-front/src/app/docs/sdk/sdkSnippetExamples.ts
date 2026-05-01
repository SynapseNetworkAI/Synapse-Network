export const SDK_GITHUB_ROOT =
  "https://github.com/cliff-personal/Synapse-Network-Sdk/blob/main";

export type SdkSnippet = {
  id: string;
  label: string;
  lang: string;
  code: string;
  guideUrl?: string;
  guideLabel?: string;
};

export function buildSdkSnippets(snippetLabels: string[]): SdkSnippet[] {
  return [
    {
      id: "typescript",
      label: snippetLabels[0] ?? "TypeScript",
      lang: "typescript",
      code: `import { SynapseClient } from "@synapse-network/sdk";

const client = new SynapseClient({
  credential: process.env.SYNAPSE_AGENT_KEY!,
  environment: "staging",
});

const result = await client.invokeLlm(
  "svc_deepseek_chat",
  { messages: [{ role: "user", content: "Summarize this." }], max_tokens: 512 },
  { maxCostUsdc: "0.010000", idempotencyKey: "llm-job-001" }
);

console.log(result.usage, result.synapse.chargedUsdc);`,
    },
    {
      id: "python",
      label: snippetLabels[1] ?? "Python",
      lang: "python",
      code: `import os

from synapse_client import SynapseClient

client = SynapseClient(
    api_key=os.environ["SYNAPSE_AGENT_KEY"],
    environment="staging",
)

result = client.invoke_llm(
    "svc_deepseek_chat",
    {"messages": [{"role": "user", "content": "Summarize this."}], "max_tokens": 512},
    max_cost_usdc="0.010000",
    idempotency_key="llm-job-001",
)

print(result.usage, result.synapse.charged_usdc)`,
    },
    {
      id: "go",
      label: snippetLabels[2] ?? "Go",
      lang: "go",
      guideUrl: `${SDK_GITHUB_ROOT}/docs/sdk/go_integration.md`,
      guideLabel: "Go Integration Guide",
      code: `go get github.com/cliff-personal/Synapse-Network-Sdk/go

client := synapse.NewClient(os.Getenv("SYNAPSE_AGENT_KEY"), synapse.WithEnvironment("staging"))

result, err := client.InvokeLLM(ctx, "svc_deepseek_chat", map[string]any{
  "messages": []map[string]string{{"role": "user", "content": "Summarize this."}},
  "max_tokens": 512,
}, synapse.InvokeLLMOptions{
  MaxCostUSDC: "0.010000",
  IdempotencyKey: "llm-job-001",
})
if err != nil { panic(err) }
fmt.Println(result.Usage, result.Synapse.ChargedUSDC)`,
    },
    {
      id: "java",
      label: snippetLabels[3] ?? "Java/JVM",
      lang: "java",
      guideUrl: `${SDK_GITHUB_ROOT}/docs/sdk/java_integration.md`,
      guideLabel: "Java/JVM Integration Guide",
      code: `var client = SynapseClient.builder()
    .credential(System.getenv("SYNAPSE_AGENT_KEY"))
    .environment("staging")
    .build();

var result = client.invokeLlm(
    "svc_deepseek_chat",
    Map.of(
        "messages", List.of(Map.of("role", "user", "content", "Summarize this.")),
        "max_tokens", 512
    ),
    InvokeLlmOptions.builder()
        .maxCostUsdc("0.010000")
        .idempotencyKey("llm-job-001")
        .build()
);

System.out.println(result.usage());`,
    },
    {
      id: "dotnet",
      label: snippetLabels[4] ?? ".NET",
      lang: "csharp",
      guideUrl: `${SDK_GITHUB_ROOT}/docs/sdk/dotnet_integration.md`,
      guideLabel: ".NET Integration Guide",
      code: `dotnet add package SynapseNetwork.Sdk

var client = new SynapseClient(new SynapseClientOptions {
    Credential = Environment.GetEnvironmentVariable("SYNAPSE_AGENT_KEY"),
    Environment = "staging",
});

var result = await client.InvokeLlmAsync(
    "svc_deepseek_chat",
    new { messages = new[] { new { role = "user", content = "Summarize this." } }, max_tokens = 512 },
    new InvokeLlmOptions { MaxCostUsdc = "0.010000", IdempotencyKey = "llm-job-001" }
);

Console.WriteLine(result.Usage);`,
    },
  ];
}
