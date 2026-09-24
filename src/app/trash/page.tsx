export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { guardPage } from "@/lib/guard";
import TrashClient from "@/components/TrashClient";

export default function TrashPage() {
  const guard = guardPage();
  if (!guard.ok) redirect(guard.redirect);
  return <TrashClient />;
}
