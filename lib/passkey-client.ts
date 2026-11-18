// Browser only. A person's passkey wallet: a Circle modular smart account on
// Arc whose only signer is a passkey on their device. Circle's paymaster covers
// the network fee, so the person never needs crypto. Loaded on demand, so the
// SDK only reaches the browser when someone actually uses a passkey.
import {
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  WebAuthnMode,
} from "@circle-fin/modular-wallets-core";
import { createPublicClient, type Hex, type Transport } from "viem";
import { createBundlerClient, toWebAuthnAccount } from "viem/account-abstraction";
import { arcTestnet } from "viem/chains";

const CLIENT_URL = "https://modular-sdk.circle.com/v1/rpc/w3s/buidl";

export function passkeysAvailable(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY) && typeof window !== "undefined" && "PublicKeyCredential" in window;
}

function clientKey(): string {
  const key = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY;
  if (!key) throw new Error("Passkeys are not set up on this site yet.");
  return key;
}

// Create a new passkey (register) or use an existing one (login), and the
// smart account it signs for.
export async function passkeyWallet(mode: "register" | "login", username?: string) {
  const key = clientKey();
  const credential = await toWebAuthnCredential({
    transport: toPasskeyTransport(CLIENT_URL, key),
    mode: mode === "register" ? WebAuthnMode.Register : WebAuthnMode.Login,
    ...(mode === "register" ? { username: username ?? "Stabl" } : {}),
  } as Parameters<typeof toWebAuthnCredential>[0]);
  // The SDK pins its own copy of viem; the shapes are the same at runtime.
  const transport = toModularTransport(`${CLIENT_URL}/arcTestnet`, key) as unknown as Transport;
  const client = createPublicClient({ chain: arcTestnet, transport });
  const account = await toCircleSmartAccount({ client, owner: toWebAuthnAccount({ credential: credential as never }) } as never);
  const bundler = createBundlerClient({ account: account as never, chain: arcTestnet, transport });
  return { account: account as unknown as { address: Hex; signMessage: (a: { message: string }) => Promise<Hex> }, bundler };
}

// Approve one vault transaction with the passkey. Returns the Arc transaction.
export async function approveWithPasskey(call: { to: Hex; data: Hex }): Promise<Hex> {
  const { bundler } = await passkeyWallet("login");
  const hash = await bundler.sendUserOperation({ calls: [{ to: call.to, data: call.data }], paymaster: true } as never);
  const { receipt } = await bundler.waitForUserOperationReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Arc did not accept that transaction.");
  return receipt.transactionHash;
}

// Turn the browser's passkey errors into plain words.
export function passkeyErrorMessage(error: unknown): string {
  const text = String((error as Error)?.message ?? error);
  if (/NotAllowedError|cancel|abort|timed out/i.test(text)) return "The passkey request was cancelled. Try again when you are ready.";
  if (/InvalidStateError|already registered/i.test(text)) return "This device already has a Stabl passkey. Use it to continue.";
  if (/not set up/i.test(text)) return text;
  return "Your passkey could not finish that. Try again in a moment.";
}
