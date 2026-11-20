"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useSession } from "@/features/identity";
import { EVENTS } from "@/features/event";

import {
  DEFAULT_ORDER,
  mapOrderResponse,
  secondsUntil,
  paymentFailureMessage,
  MISSING_PAYMENT_URL_MESSAGE,
  type CheckoutOrder,
} from "../domain/checkout-rules";
import {
  createVnpayPayment,
  fetchOrder,
  releaseOrderBestEffort,
  paymentErrorStatus,
} from "../api/checkout-client";

/** Trang thai va hanh dong cua man hinh thanh toan (dong ho giu cho, ma giam gia, VNPay). */
export function useCheckoutScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  const { user } = useSession();

  const [order, setOrder] = useState<CheckoutOrder>(DEFAULT_ORDER);
  const [isLoading, setIsLoading] = useState(Boolean(orderId));
  const [secondsLeft, setSecondsLeft] = useState(299);
  const [isExpired, setIsExpired] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Carousel state
  const carouselImages = [
    {
      src: "/assets/seat-view.jpg",
      alt: "Góc nhìn từ chỗ ngồi - Trung tâm Hội nghị Quốc gia",
      label: "Góc nhìn từ chỗ ngồi (View from Seat)",
    },
    {
      src: "/assets/artist-banner.webp",
      alt: "Sân khấu đại nhạc hội",
      label: "Sân khấu đại nhạc hội",
    },
  ];
  const [currentSlide, setCurrentSlide] = useState(0);

  const [isSubmittingPayment, startPaymentTransition] = useTransition();
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);

  // Load real order data from backend if orderId is provided
  useEffect(() => {
    if (!orderId) {
      return;
    }

    let isMounted = true;
    async function loadOrder() {
      try {
        const raw = await fetchOrder(orderId as string);
        if (!raw) throw new Error("Order not found");
        if (isMounted) {
          const mappedOrder = mapOrderResponse(
            raw,
            orderId as string,
            Date.now(),
          );
          setOrder(mappedOrder);
          setOrderError(null);
          if (mappedOrder.expiresAt) {
            const diff = secondsUntil(mappedOrder.expiresAt, Date.now());
            setSecondsLeft(diff);
            setIsExpired(diff <= 0);
          }
        }
      } catch {
        if (isMounted)
          setOrderError(
            "Không thể tải đơn hàng. Vui lòng đăng nhập đúng tài khoản hoặc thử lại.",
          );
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadOrder();
    return () => {
      isMounted = false;
    };
  }, [orderId]);

  // Handle release seats when expired
  const handleExpireRelease = useCallback(async () => {
    setIsExpired(true);
    if (order.orderId) {
      await releaseOrderBestEffort(order.orderId);
    }
  }, [order.orderId]);

  const hasOrder = Boolean(
    orderId && order.orderId === orderId && !isLoading && !orderError,
  );
  const canPay =
    hasOrder &&
    order.status === "PENDING" &&
    !isExpired &&
    order.finalAmount > 0;

  // Countdown timer logic
  useEffect(() => {
    if (!canPay) return;

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleExpireRelease();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [canPay, handleExpireRelease]);

  const confirmCancelHold = async () => {
    setIsCancelling(true);
    try {
      if (order.orderId) await releaseOrderBestEffort(order.orderId);
    } finally {
      setIsCancelling(false);
      router.push("/events");
    }
  };

  const handlePaymentSubmit = () => {
    if (!canPay) return;
    setPaymentError(null);
    startPaymentTransition(async () => {
      try {
        const paymentUrl = await createVnpayPayment(order.orderId);
        if (!paymentUrl) {
          setPaymentError(MISSING_PAYMENT_URL_MESSAGE);
          return;
        }
        const target = new URL(paymentUrl);
        if (
          target.protocol !== "https:" ||
          !["sandbox.vnpayment.vn", "pay.vnpay.vn"].includes(target.hostname)
        )
          throw new Error("Invalid VNPay checkout URL");
        window.location.assign(target.href);
      } catch (err) {
        setPaymentError(paymentFailureMessage(paymentErrorStatus(err)));
      }
    });
  };

  const eventData = EVENTS.find((e) => e.id === order.eventId) || EVENTS[0];
  const ticketItem = order.items[0] || DEFAULT_ORDER.items[0];

  return {
    showCancelModal,
    showInfoModal,
    showPaymentModal,
    router,
    order,
    secondsLeft,
    isExpired,
    setShowCancelModal,
    setShowInfoModal,
    setShowPaymentModal,
    isCancelling,
    carouselImages,
    currentSlide,
    setCurrentSlide,
    email: user?.email,
    hasOrder,
    canPay,
    isLoading,
    orderError,
    voucherDiscount: order.discountAmount,
    voucherAppliedCode: order.voucherCode,
    isSubmittingPayment,
    paymentError,
    confirmCancelHold,
    handlePaymentSubmit,
    subtotal: order.totalAmount,
    finalTotal: order.finalAmount,
    eventData,
    ticketItem,
  };
}

export type CheckoutScreen = ReturnType<typeof useCheckoutScreen>;
