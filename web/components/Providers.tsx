"use client";

import type { ReactNode } from "react";
import { ToastProvider } from "./Toast";
import { AppProvider, useApp } from "@/lib/store";
import Header from "./Header";
import SWRegister from "./SWRegister";
import LoginScreen from "./LoginScreen";
import ChangePasswordScreen from "./ChangePasswordScreen";
import RoadblockSheet from "./RoadblockSheet";
import { Skeleton, SkeletonList } from "./Skeleton";

function Shell({ children }: { children: ReactNode }) {
  const { ready, user, mustChangePassword, changePasswordOpen } = useApp();

  if (!ready) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Skeleton className="mb-8 h-10 w-56" />
        <SkeletonList count={4} />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  // Forced (mustChangePassword) or voluntary (user menu) — both block the app.
  if (mustChangePassword || changePasswordOpen) {
    return <ChangePasswordScreen />;
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6">{children}</main>
      <RoadblockSheet />
    </>
  );
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AppProvider>
        <SWRegister />
        <Shell>{children}</Shell>
      </AppProvider>
    </ToastProvider>
  );
}
