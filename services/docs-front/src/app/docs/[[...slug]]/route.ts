import { redirect } from "next/navigation";

export async function GET(
  _request: Request,
  context: RouteContext<"/docs/[[...slug]]">
) {
  const params = await context.params;
  const slug = params.slug ?? [];
  const normalized = slug.join("/");

  if (!normalized) {
    redirect("/");
  }

  const rewritten = normalized
    .replace(/^getting-started\/consumer(?=\/|$)/, "get-started/agent-builders")
    .replace(/^getting-started\/provider(?=\/|$)/, "get-started/api-providers")
    .replace(/^getting-started(?=\/|$)/, "get-started")
    .replace(/^sdk(?=\/|$)/, "sdks")
    .replace(/^contracts(?=\/|$)/, "smart-contracts");

  redirect(`/${rewritten}`);
}
