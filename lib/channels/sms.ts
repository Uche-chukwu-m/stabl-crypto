// SMS is off in this build. A Twilio trial can only text 5 verified numbers with
// Twilio's own templates, so custom receipts are not possible. This adapter keeps
// the slot so a paid account can switch it on later without touching notify().
export function smsReady(): boolean {
  return false;
}

export async function sendSms(...message: [to: string, text: string]): Promise<boolean> {
  void message;
  return false;
}
