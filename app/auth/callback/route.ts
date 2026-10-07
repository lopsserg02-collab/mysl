import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";
import { supabaseAuthEnabled } from "@/lib/auth-config";

// Magic links and Google sign-in come back here with a one-time code.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  // Without Supabase Auth configured there is nothing to exchange the code with.
  if (code && supabaseAuthEnabled()) {
    const { error } = await (await supabaseServer()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL(`/login?error=link`, url.origin));
}
