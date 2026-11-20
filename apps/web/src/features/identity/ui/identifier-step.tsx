"use client";

import Link from "next/link";
import { AlertCircle, Loader2, Mail } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { FEATURE_PHONE_AUTH } from "../api/auth-api";
import type { AuthFlow } from "./use-auth-flow";

/** Buoc 1: nhap email tai khoan. */
export function IdentifierStep({ flow }: { flow: AuthFlow }) {
  const {
    step1Error,
    step1NetworkError,
    rateLimitTimer,
    identifierInputRef,
    registerId,
    handleIdSubmit,
    getValuesId,
    idErrors,
    isCheckingId,
    onIdentifierSubmit,
  } = flow;

  return (
    <div className="col-start-1 row-start-1 w-full self-start flex flex-col gap-7 animate-in fade-in-50 duration-200 motion-reduce:animate-none">
      <header className="flex flex-col gap-2 text-left">
        <h1 className="text-[28px] leading-8 font-semibold tracking-tight text-foreground">
          Đăng nhập hoặc tạo tài khoản
        </h1>
        <p className="text-base text-muted-foreground leading-normal">
          Nhập email của bạn để tiếp tục.
        </p>
      </header>

      <form
        onSubmit={handleIdSubmit(onIdentifierSubmit)}
        noValidate
        className="flex flex-col gap-6"
      >
        {/* Edge Case Alerts (Network Error, Rate Limit, etc.) */}
        {step1Error && (
          <div
            role="alert"
            className="flex items-start justify-between gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs sm:text-[13px] font-medium text-destructive"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{step1Error}</span>
            </div>
            {step1NetworkError && (
              <button
                type="button"
                onClick={() => {
                  const curVal = getValuesId("identifier");
                  if (curVal) onIdentifierSubmit({ identifier: curVal });
                }}
                className="underline hover:no-underline font-semibold text-destructive shrink-0 cursor-pointer"
              >
                Thử lại
              </button>
            )}
          </div>
        )}

        {/* Single Identifier Field */}
        <div className="flex flex-col gap-2">
          <Label
            htmlFor="identifier"
            className="text-sm font-medium text-foreground"
          >
            {FEATURE_PHONE_AUTH ? "Email hoặc số điện thoại" : "Email"}
          </Label>
          <div className="flex flex-col gap-1.5">
            <div className="relative">
              <Mail className="size-5 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                {...registerId("identifier")}
                ref={(e) => {
                  registerId("identifier").ref(e);
                  identifierInputRef.current = e;
                }}
                id="identifier"
                type="email"
                autoComplete="username"
                inputMode="email"
                autoFocus
                required
                aria-required="true"
                placeholder="Ví dụ: nguyenan@example.com"
                className={`h-12 pl-11 pr-3.5 rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 transition-colors ${
                  idErrors.identifier
                    ? "border-destructive focus-visible:border-destructive"
                    : "border border-muted-foreground hover:border-foreground"
                }`}
                aria-invalid={!!idErrors.identifier}
                aria-describedby={
                  idErrors.identifier ? "identifier-error" : undefined
                }
              />
            </div>
            {idErrors.identifier && (
              <p
                id="identifier-error"
                role="alert"
                className="flex items-center gap-1.5 text-[13px] text-destructive font-medium"
              >
                <AlertCircle className="size-3.5 shrink-0" />
                <span>{idErrors.identifier.message}</span>
              </p>
            )}
          </div>
        </div>

        {/* Submit Button & Consent Line */}
        <div className="flex flex-col gap-3">
          <Button
            type="submit"
            disabled={isCheckingId || rateLimitTimer !== null}
            className="w-full h-12 rounded-lg font-semibold text-base bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
          >
            {isCheckingId ? (
              <span className="flex items-center gap-2">
                <Loader2 className="size-5 animate-spin" />
                <span>Đang kiểm tra...</span>
              </span>
            ) : rateLimitTimer !== null ? (
              `Thử lại sau (${rateLimitTimer}s)`
            ) : (
              "Tiếp tục"
            )}
          </Button>

          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            Bằng việc tiếp tục, bạn đồng ý với{" "}
            <Link
              href="/faq?tab=terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-semibold hover:underline"
            >
              Điều khoản sử dụng
            </Link>{" "}
            và{" "}
            <Link
              href="/faq?tab=privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-semibold hover:underline"
            >
              Chính sách bảo mật
            </Link>
            .
          </p>
        </div>
      </form>
    </div>
  );
}
