"use client";

import { Button, HStack } from "@chakra-ui/react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { useAdminSession } from "@/lib/use-admin-session";

import { ForumResponseQueue } from "./forum-response-queue";
import { ForumTopicWorkbench } from "./forum-topic-workbench";
import type { ForumSupportWorkbenchView } from "./forum-support-types";
import { useForumSupportActions } from "./use-forum-support-actions";
import { useForumSupportData } from "./use-forum-support-data";

export function ForumSupportWorkspace() {
  const { admin, token, loading } = useAdminSession();
  const data = useForumSupportData(token);
  const actions = useForumSupportActions(token, data);

  if (loading || !admin) {
    return (
      <ControlPlaneLoadingScreen
        title="Forum Support"
        message="正在加载社区支持运营台..."
      />
    );
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Community Support"
      title="Forum Support Operations"
      description="所有帖子生命周期和未回复队列在这里收口；Agent 只给建议，最终公开回复和关闭动作必须由管理员确认。"
      actions={<ForumSupportActions data={data} busy={actions.busy} />}
    >
      {data.error ? <MessageBanner kind="error" message={data.error} /> : null}
      {data.notice ? (
        <MessageBanner kind="success" message={data.notice} />
      ) : null}
      {data.view === "topics" ? (
        <ForumTopicWorkbench data={data} actions={actions} />
      ) : (
        <ForumResponseQueue data={data} actions={actions} />
      )}
    </AdminShell>
  );
}

function ForumSupportActions({
  data,
  busy,
}: Readonly<{ data: ReturnType<typeof useForumSupportData>; busy: boolean }>) {
  return (
    <HStack>
      <ForumViewButton view="topics" data={data}>
        All Topics
      </ForumViewButton>
      <ForumViewButton view="queue" data={data}>
        Response Queue
      </ForumViewButton>
      <ForumViewButton view="history" data={data}>
        History
      </ForumViewButton>
      <Button
        onClick={() =>
          data.view === "topics"
            ? void data.refreshTopics()
            : void data.refreshTasks()
        }
        disabled={busy}
      >
        刷新
      </Button>
    </HStack>
  );
}

function ForumViewButton({
  view,
  data,
  children,
}: Readonly<{
  view: ForumSupportWorkbenchView;
  data: ReturnType<typeof useForumSupportData>;
  children: string;
}>) {
  return (
    <Button
      variant={data.view === view ? "solid" : "outline"}
      onClick={() => data.setView(view)}
    >
      {children}
    </Button>
  );
}
