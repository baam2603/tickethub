"use client";

import { ChevronRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { CheckoutScreen } from "./use-checkout-screen";

/** Thanh thanh toan co dinh o man hinh nho. */
export function MobilePayBar({ vm }: { vm: CheckoutScreen }) {
  const { isExpired, setShowPaymentModal, finalTotal } = vm;

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur-md border-t border-border px-4 py-3 flex items-center justify-between gap-3 shadow-lg">
      <div>
        <div className="text-[11px] text-muted-foreground">
          Tổng cộng (Đã gồm VAT)
        </div>
        <div className="text-base sm:text-lg font-black text-foreground">
          {finalTotal.toLocaleString("vi-VN")} ₫
        </div>
      </div>
      <Button
        type="button"
        onClick={() => setShowPaymentModal(true)}
        disabled={isExpired}
        className="h-10 px-5 text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 rounded-md shadow-xs flex items-center gap-1.5 cursor-pointer"
      >
        <span>Tiếp tục</span>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
