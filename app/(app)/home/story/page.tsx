import type { Metadata } from "next";
import { LargeTitle } from "@/components/LargeTitle";
import { StoryChart } from "@/components/StoryChart";
import { requireOnboardedUser } from "@/lib/session";
import { homeView } from "@/lib/views";

export const metadata: Metadata = { title: "How it works" };

const STEPS = [
  { title: "Good weeks", text: "Stabl sets aside what you did not need." },
  { title: "Slow weeks", text: "It sends money back right away." },
  { title: "Always", text: "Your bills come first. Every move gets a message." },
];

export default async function StoryPage() {
  const user = await requireOnboardedUser();
  const v = await homeView(user.id);
  return (
    <div className="space-y-4">
      <LargeTitle>How it works</LargeTitle>
      <section className="card rise p-5 pt-9">
        <StoryChart weeks={v.weeks} band={v.weeklyBand} />
      </section>
      <ol className="rise rise-2 grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="card p-4">
            <span className="figure text-[1.5rem] text-accent">{i + 1}</span>
            <p className="mt-1 font-bold">{s.title}</p>
            <p className="text-caption text-muted">{s.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
