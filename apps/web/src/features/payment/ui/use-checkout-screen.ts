"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useSession } from "@/features/identity";
import { EVENTS } from "@/features/event";

import {
  DEFAULT_ORDER,
  GUEST_PREFILL,
  computeTotals,
  evaluateVoucher,
  fallbackOrder,
  mapOrderResponse,
  secondsUntil,
  splitFullName,
  validateRecipient,
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

  // Form states for checkout payment modal
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<
    "vnpay_qr" | "vnpay_atm" | "vnpay_intl"
  >("vnpay_qr");
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherDiscount, setVoucherDiscount] = useState(0);
  const [voucherAppliedCode, setVoucherAppliedCode] = useState<string | null>(
    null,
  );
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [isSubmittingPayment, startPaymentTransition] = useTransition();
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Autofill user info if authenticated
  useEffect(() => {
    queueMicrotask(() => {
      if (user) {
        if (user.fullName) {
          const name = splitFullName(user.fullName);
          setFirstName(name.firstName);
          setLastName(name.lastName);
        }
        if (user.email) setEmail(user.email);
      } else {
        setFirstName(GUEST_PREFILL.firstName);
        setLastName(GUEST_PREFILL.lastName);
        setEmail(GUEST_PREFILL.email);
        setPhone(GUEST_PREFILL.phone);
      }
    });
  }, [user]);

  // Load real order data from backend if orderId is provided
  useEffect(() => {
    if (!orderId) {
      return;
    }

    let isMounted = true;
    async function loadOrder() {
      try {
        const raw = await fetchOrder(orderId as string);
        if (isMounted && raw) {
          const mappedOrder = mapOrderResponse(
            raw,
            orderId as string,
            Date.now(),
          );
          setOrder(mappedOrder);
          if (mappedOrder.expiresAt) {
            const diff = secondsUntil(mappedOrder.expiresAt, Date.now());
            setSecondsLeft(diff);
            if (diff <= 0) setIsExpired(true);
          }
        }
      } catch {
        if (isMounted) setOrder(fallbackOrder(orderId));
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

  // Countdown timer logic
  useEffect(() => {
    if (isLoading || isExpired) return;

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
  }, [isLoading, isExpired, handleExpireRelease]);

  const confirmCancelHold = async () => {
    setIsCancelling(true);
    try {
      if (order.orderId) await releaseOrderBestEffort(order.orderId);
    } finally {
      setIsCancelling(false);
      router.push("/events");
    }
  };

  const handleApplyVoucher = () => {
    setVoucherError(null);
    const result = evaluateVoucher(voucherCode, order.totalAmount);
    if (result.ok) {
      setVoucherDiscount(result.discount);
      setVoucherAppliedCode(result.code);
      setVoucherError(null);
    } else {
      setVoucherDiscount(0);
      setVoucherAppliedCode(null);
      setVoucherError(result.error);
    }
  };

  const handlePaymentSubmit = () => {
    setPaymentError(null);
    const recipient = { firstName, lastName, email, phone };
    const invalid = validateRecipient(recipient);
    if (invalid) {
      setPaymentError(invalid);
      return;
    }

    startPaymentTransition(async () => {
      try {
        const paymentUrl = await createVnpayPayment({
          orderId: order.orderId,
          paymentMethod,
          voucherCode: voucherAppliedCode,
          recipient,
        });

        if (paymentUrl) {
          window.location.href = paymentUrl;
        } else {
          // Khong co URL thanh toan: bao loi, tuyet doi khong gia lap thanh cong
          setPaymentError(MISSING_PAYMENT_URL_MESSAGE);
        }
      } catch (err) {
        setPaymentError(paymentFailureMessage(paymentErrorStatus(err)));
      }
    });
  };

  const { subtotal, platformFee, finalTotal } = computeTotals(
    order.totalAmount,
    voucherDiscount,
  );

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
    firstName,
    setFirstName,
    lastName,
    setLastName,
    email,
    setEmail,
    phone,
    setPhone,
    paymentMethod,
    setPaymentMethod,
    voucherCode,
    setVoucherCode,
    voucherDiscount,
    voucherAppliedCode,
    voucherError,
    isSubmittingPayment,
    paymentError,
    confirmCancelHold,
    handleApplyVoucher,
    handlePaymentSubmit,
    subtotal,
    platformFee,
    finalTotal,
    eventData,
    ticketItem,
  };
}

export type CheckoutScreen = ReturnType<typeof useCheckoutScreen>;
