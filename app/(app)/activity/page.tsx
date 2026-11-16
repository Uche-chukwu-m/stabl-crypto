import type { Metadata } from "next";
import { FeedList } from "@/components/FeedList";
import { LargeTitle } from "@/components/LargeTitle";
import { loadContext } from "@/lib/context";
import { requireOnboardedUser } from "@/lib/session";
import { activityFeed } from "@/lib/views";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage() {
  const user = await requireOnboardedUser();
  const [{ today }, feed] = await Promise.all([loadContext(user.id), activityFeed(user.id, { days: 60 })]);
  return (
    <div className="space-y-4">
      <LargeTitle>Activity</LargeTitle>
      <div className="card rise p-4">
        <FeedList items={feed} today={today} />
      </div>
    </div>
  );
}
