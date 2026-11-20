"use client";

import { Suspense } from "react";
import { useCheckoutScreen } from "./use-checkout-screen";
import { CheckoutHeader } from "./checkout-header";
import { CheckoutMain } from "./checkout-main";
import { MobilePayBar } from "./mobile-pay-bar";
import { CheckoutFooter } from "./checkout-footer";
import { PaymentModal } from "./payment-modal";
import { HoldInfoModal } from "./hold-info-modal";
import { ExpiredModal } from "./expired-modal";
import { CancelModal } from "./cancel-modal";

function CheckoutContent() {
  const vm = useCheckoutScreen();
  const { showPaymentModal, showInfoModal, isExpired, showCancelModal } = vm;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased flex flex-col justify-between">
      <CheckoutHeader vm={vm} />
      <CheckoutMain vm={vm} />
      <MobilePayBar vm={vm} />
      <CheckoutFooter />

      {showPaymentModal && <PaymentModal vm={vm} />}
      {showInfoModal && <HoldInfoModal vm={vm} />}
      {isExpired && <ExpiredModal vm={vm} />}
      {showCancelModal && <CancelModal vm={vm} />}
    </div>
  );
}

export function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground font-medium">
              Đang tải thông tin đặt vé...
            </p>
          </div>
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
