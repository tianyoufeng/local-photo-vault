import { redirect } from "next/navigation";
import { guardPage } from "@/lib/guard";
import GalleryClient from "@/components/GalleryClient";

// standalone 静态预渲染下 cookies() 不可用（500），强制动态渲染
export const dynamic = "force-dynamic";

export default function HomePage() {
  const guard = guardPage();
  if (!guard.ok) redirect(guard.redirect);
  return <GalleryClient />;
}
