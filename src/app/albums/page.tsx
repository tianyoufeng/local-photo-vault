export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { guardPage } from "@/lib/guard";
import AlbumsClient from "@/components/AlbumsClient";

export default function AlbumsPage() {
  const guard = guardPage();
  if (!guard.ok) redirect(guard.redirect);
  return <AlbumsClient />;
}
