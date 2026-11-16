import type { Metadata } from "next";
import { LargeTitle } from "@/components/LargeTitle";
import { Thread } from "@/components/Thread";
import { requireOnboardedUser } from "@/lib/session";
import { threadFor } from "@/lib/views";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  const user = await requireOnboardedUser();
  return (
    <div className="space-y-2">
      <LargeTitle>Messages</LargeTitle>
      <Thread initial={await threadFor(user.id)} timezone={user.timezone} />
    </div>
  );
}
