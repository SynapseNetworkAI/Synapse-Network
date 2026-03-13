const fs = require('fs');

const code = `
// --- Secrets Management ---

export type ProviderSecret = {
  id: string;
  name: string;
  ownerAddress: string;
  secretKey?: string;
  maskedKey: string;
  createdAt: number;
};

export async function listApiSecrets(userAddress: string): Promise<ProviderSecret[]> {
  const response = await fetch(\`\${API_BASE_URL.replace('/services', '/secrets')}\`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Backend secrets list failed"));
  }

  const payload = (await response.json()) as { secrets?: ProviderSecret[] };
  return Array.isArray(payload.secrets) ? payload.secrets : [];
}

export async function createApiSecret(name: string, userAddress: string): Promise<ProviderSecret> {
  const response = await fetch(\`\${API_BASE_URL.replace('/services', '/secrets')}\`, {
    method: "POST",
    headers: buildAuthedHeaders(userAddress),
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Backend secret creation failed"));
  }

  const data = (await response.json()) as { secret?: ProviderSecret };
  if (data.secret) {
    return data.secret;
  }
  throw new Error("Backend response missing secret payload");
}

export async function deleteApiSecret(secretId: string, userAddress: string): Promise<void> {
  const response = await fetch(\`\${API_BASE_URL.replace('/services', '/secrets')}/\${secretId}\`, {
    method: "DELETE",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Backend secret delete failed"));
  }
}
`;

const path = "/Users/cliff/workspace/A2A-pay/frontend/src/utils/serviceApi.ts";
const content = fs.readFileSync(path, 'utf8');
if (!content.includes('listApiSecrets')) {
  fs.appendFileSync(path, code);
  console.log("Appended success");
}
