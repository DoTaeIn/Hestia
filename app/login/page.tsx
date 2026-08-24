import type { Metadata } from "next";
import { Suspense } from "react";
import LoginForm from "./LoginForm";
import "../tool.css";

export const metadata: Metadata = {
  title: "로그인 — Hestia",
};

export default function LoginPage() {
  // LoginForm reads ?next= to send you back where you were headed
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
