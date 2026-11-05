import { z } from "zod";

export const VenueCityEnum = ["TP. Hồ Chí Minh", "Hà Nội", "Đà Nẵng"] as const;
export type VenueCity = (typeof VenueCityEnum)[number];

export const VenueCategoryEnum = [
  "stadium",
  "arena",
  "theater",
  "sports",
] as const;
export type VenueCategory = (typeof VenueCategoryEnum)[number];

// Hàm kiểm tra an toàn cho nội dung SVG
const isSafeSvg = (content: string): boolean => {
  const lower = content.toLowerCase();
  if (lower.includes("<script") || lower.includes("</script>")) {
    return false;
  }
  // Kiểm tra thuộc tính onload, onclick,...
  if (/\son[a-z]+\s*=/i.test(content)) {
    return false;
  }
  return true;
};

export const DefaultZoneSchema = z.object({
  zoneName: z.string().min(1, "Tên khu vực không được để trống"),
  color: z
    .string()
    .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Mã màu hex không hợp lệ"),
  price: z.number().int().nonnegative("Giá vé không được âm"),
  capacity: z.number().int().positive("Sức chứa phải lớn hơn 0"),
});

export type DefaultZone = z.infer<typeof DefaultZoneSchema>;

export const CreateVenueSchema = z.object({
  name: z.string().min(1, "Tên địa điểm không được để trống").max(255),
  shortName: z.string().min(1, "Tên rút gọn không được để trống").max(100),
  city: z.enum(VenueCityEnum, {
    message: "Thành phố phải thuộc: TP. Hồ Chí Minh, Hà Nội hoặc Đà Nẵng",
  }),
  district: z.string().min(1, "Quận/Huyện không được để trống").max(100),
  address: z.string().min(1, "Địa chỉ không được để trống"),
  category: z.enum(VenueCategoryEnum, {
    message: "Loại hình phải thuộc: stadium, arena, theater hoặc sports",
  }),
  totalCapacity: z.string().min(1, "Sức chứa không được để trống").max(50),
  thumbnailUrl: z.string().max(500).optional(),
  description: z.string().optional(),
});

export type CreateVenueDto = z.infer<typeof CreateVenueSchema>;

export const UpdateVenueSchema = CreateVenueSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type UpdateVenueDto = z.infer<typeof UpdateVenueSchema>;

export const CreateVenueLayoutSchema = z.object({
  name: z.string().min(1, "Tên cấu hình không được để trống").max(255),
  categoryName: z.string().min(1, "Phân loại không được để trống").max(100),
  description: z.string().optional(),
  capacityEstimate: z
    .string()
    .min(1, "Sức chứa dự kiến không được để trống")
    .max(50),
  mapKey: z.string().min(1, "Mã định danh sơ đồ không được để trống").max(100),
  svgContent: z
    .string()
    .refine(
      (content) => !content || isSafeSvg(content),
      "Mã SVG chứa thẻ script hoặc thuộc tính không an toàn",
    )
    .optional(),
  defaultZones: z.array(DefaultZoneSchema).default([]),
  isDefault: z.boolean().optional().default(false),
});

export type CreateVenueLayoutDto = z.infer<typeof CreateVenueLayoutSchema>;

export const VenueFilterQuerySchema = z.object({
  city: z.enum(VenueCityEnum).optional(),
  category: z.enum(VenueCategoryEnum).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type VenueFilterQueryDto = z.infer<typeof VenueFilterQuerySchema>;
