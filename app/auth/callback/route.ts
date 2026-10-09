import { NextResponse } from "next/server";

// Sign-in links from before our own sign-in (Supabase Auth) came back here. They no longer work:
// the person is asked for a new link.
export async function GET(req: Request) {
  return NextResponse.redirect(new URL("/login?error=link", new URL(req.url).origin));
}
