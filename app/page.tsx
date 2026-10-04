import { redirect } from "next/navigation";

// Until accounts exist (M2), the front door is the sign-in page.
export default function Home() {
  redirect("/sign-in");
}
