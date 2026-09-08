import { StartChatForm } from "@/components/chat/start-chat-form";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-6 py-6">
      <StartChatForm />
    </div>
  );
}
