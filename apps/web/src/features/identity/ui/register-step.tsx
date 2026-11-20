"use client";

import Link from "next/link";
import {
  AlertCircle,
  Building2,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  User,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import type { AuthFlow } from "./use-auth-flow";

/** Buoc 2b: tai khoan moi, dien thong tin dang ky. */
export function RegisterStep({ flow }: { flow: AuthFlow }) {
  const {
    identifier,
    roleTab,
    setRoleTab,
    showPassword,
    setShowPassword,
    registerError,
    fullNameInputRef,
    registerReg,
    handleRegSubmit,
    regErrors,
    isRegistering,
    watchedPassword,
    handleBackToIdentifier,
    onRegisterSubmit,
  } = flow;

  return (
    <div className="col-start-1 row-start-1 w-full self-start flex flex-col gap-7 animate-in fade-in-50 duration-200 motion-reduce:animate-none">
      <header className="flex flex-col gap-2 text-left">
        <h1 className="text-[28px] leading-8 font-semibold tracking-tight text-foreground">
          Tạo tài khoản
        </h1>
        <p className="text-base text-muted-foreground leading-normal">
          {roleTab === "ORGANIZER"
            ? "Đăng ký tài khoản ban tổ chức để bắt đầu tạo sự kiện."
            : "Hoàn tất thông tin cá nhân để hoàn tất đăng ký."}
        </p>
      </header>

      <form
        onSubmit={handleRegSubmit(onRegisterSubmit)}
        noValidate
        className="flex flex-col gap-6"
      >
        {/* Visually hidden email input for password managers */}
        <input
          type="email"
          name="email"
          value={identifier}
          autoComplete="email"
          readOnly
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />

        {registerError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs sm:text-[13px] font-medium text-destructive"
          >
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{registerError}</span>
          </div>
        )}

        <div className="flex flex-col gap-5">
          {/* Identifier Chip Row with "Đổi" */}
          <div
            data-slot="identifier-chip"
            className="h-12 w-full flex items-center justify-between px-3.5 rounded-lg border border-border bg-muted/50 text-foreground"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <User className="size-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium truncate text-foreground">
                {identifier}
              </span>
            </div>
            <button
              type="button"
              onClick={handleBackToIdentifier}
              className="h-11 px-2.5 text-sm font-semibold text-primary hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md shrink-0 flex items-center"
              aria-label={`Thay đổi tài khoản ${identifier}`}
            >
              Đổi
            </button>
          </div>

          {/* Full name field */}
          <div className="flex flex-col gap-2">
            <Label
              htmlFor="fullName"
              className="text-sm font-medium text-foreground"
            >
              Họ và tên
            </Label>
            <div className="flex flex-col gap-1.5">
              <div className="relative">
                <User className="size-5 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  {...registerReg("fullName")}
                  ref={(e) => {
                    registerReg("fullName").ref(e);
                    fullNameInputRef.current = e;
                  }}
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  aria-required="true"
                  placeholder="Ví dụ: Nguyễn Văn An"
                  className={`h-12 pl-11 pr-3.5 rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 transition-colors ${
                    regErrors.fullName
                      ? "border-destructive focus-visible:border-destructive"
                      : "border border-muted-foreground hover:border-foreground"
                  }`}
                  aria-invalid={!!regErrors.fullName}
                  aria-describedby={
                    regErrors.fullName ? "fullName-error" : undefined
                  }
                />
              </div>
              {regErrors.fullName && (
                <p
                  id="fullName-error"
                  role="alert"
                  className="flex items-center gap-1.5 text-[13px] text-destructive font-medium"
                >
                  <AlertCircle className="size-3.5 shrink-0" />
                  <span>{regErrors.fullName.message}</span>
                </p>
              )}
            </div>
          </div>

          {/* Organizer-only field (if roleTab is ORGANIZER) */}
          {roleTab === "ORGANIZER" && (
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="organizationName"
                className="text-sm font-medium text-foreground"
              >
                Tên Tổ chức / Doanh nghiệp
              </Label>
              <div className="flex flex-col gap-1.5">
                <div className="relative">
                  <Building2 className="size-5 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    {...registerReg("organizationName")}
                    id="organizationName"
                    type="text"
                    autoComplete="organization"
                    required
                    aria-required="true"
                    placeholder="Ví dụ: Công ty Giải trí & Sự kiện ABC"
                    className="h-12 pl-11 pr-3.5 rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 transition-colors border border-muted-foreground hover:border-foreground"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Password field */}
          <div className="flex flex-col gap-2">
            <Label
              htmlFor="register-password"
              className="text-sm font-medium text-foreground"
            >
              Mật khẩu
            </Label>
            <div className="flex flex-col gap-1.5">
              <div className="relative">
                <Lock className="size-5 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  {...registerReg("password")}
                  id="register-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  aria-required="true"
                  placeholder="Nhập mật khẩu"
                  className={`h-12 pl-11 pr-11 rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 transition-colors ${
                    regErrors.password
                      ? "border-destructive focus-visible:border-destructive"
                      : "border border-muted-foreground hover:border-foreground"
                  }`}
                  aria-invalid={!!regErrors.password}
                  aria-describedby={
                    regErrors.password
                      ? "register-password-error"
                      : "password-hint"
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xs p-1"
                  aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                >
                  {showPassword ? (
                    <EyeOff className="size-5" />
                  ) : (
                    <Eye className="size-5" />
                  )}
                </button>
              </div>

              {/* Helper text clearly belonging to password input (6px gap) */}
              <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                <span id="password-hint">Tối thiểu 8 ký tự</span>
                {watchedPassword && watchedPassword.length >= 8 && (
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium text-[11px]">
                    <Check className="size-3 text-emerald-600" />
                    <span>Đạt độ dài yêu cầu</span>
                  </span>
                )}
              </div>

              {regErrors.password && (
                <p
                  id="register-password-error"
                  role="alert"
                  className="flex items-center gap-1.5 text-[13px] text-destructive font-medium"
                >
                  <AlertCircle className="size-3.5 shrink-0" />
                  <span>{regErrors.password.message}</span>
                </p>
              )}
            </div>
          </div>

          {/* Role Switcher Link (Text link only, no segmented control) */}
          <div className="pt-1">
            {roleTab === "BUYER" ? (
              <button
                type="button"
                onClick={() => setRoleTab("ORGANIZER")}
                className="text-xs sm:text-[13px] text-muted-foreground hover:text-foreground text-left cursor-pointer transition-colors"
              >
                Bạn là ban tổ chức?{" "}
                <span className="text-primary font-semibold hover:underline">
                  Đăng ký tại đây
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setRoleTab("BUYER")}
                className="text-xs sm:text-[13px] text-muted-foreground hover:text-foreground text-left cursor-pointer transition-colors"
              >
                Tài khoản cá nhân mua vé?{" "}
                <span className="text-primary font-semibold hover:underline">
                  Đăng ký tài khoản người mua
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Submit Button & Consent Line (no consent checkbox) */}
        <div className="flex flex-col gap-3">
          <Button
            type="submit"
            disabled={isRegistering}
            className="w-full h-12 rounded-lg font-semibold text-base bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
          >
            {isRegistering ? (
              <span className="flex items-center gap-2">
                <Loader2 className="size-5 animate-spin" />
                <span>Đang tạo tài khoản...</span>
              </span>
            ) : (
              "Tạo tài khoản"
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
