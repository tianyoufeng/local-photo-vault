export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { guardPage } from "@/lib/guard";
import PhotoDetail from "@/components/PhotoDetail";

export default function PhotoPage({ params }: { params: { id: string } }) {
  const guard = guardPage();
  if (!guard.ok) redirect(guard.redirect);
  return <PhotoDetail id={params.id} />;
}
