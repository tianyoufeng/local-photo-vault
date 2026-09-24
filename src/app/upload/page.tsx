export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { guardPage } from "@/lib/guard";
import UploadMobile from "@/components/UploadMobile";

export default function UploadPage() {
  const guard = guardPage();
  if (!guard.ok) redirect(guard.redirect);
  return <UploadMobile />;
}
