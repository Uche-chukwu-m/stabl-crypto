import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "@/lib/session";
import { VaultError } from "@/lib/vault/provider";

// Every route handler runs through this: one shape for errors, and no stack
// traces or internals in responses.
export function route<C>(handler: (request: Request, context: C) => Promise<Response | object | void>) {
  return async (request: Request, context: C) => {
    try {
      const result = await handler(request, context);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
      if (error instanceof ZodError) return NextResponse.json({ error: "Check the form and try again." }, { status: 400 });
      if (error instanceof VaultError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
      console.error(error);
      return NextResponse.json({ error: "Something went wrong. Nothing moved." }, { status: 500 });
    }
  };
}

export function tooMany() {
  return new HttpError(429, "Too many tries. Wait a minute and try again.");
}
