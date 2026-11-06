import "reflect-metadata";
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, inArray } from "drizzle-orm";
import { db, sqlClient } from "../src/database/db";
import { env } from "../src/config/env.config";
import { users, organizerProfiles, events } from "../src/database/schema";
import { SearchController } from "../src/search/search.controller";
import { SearchService } from "../src/search/search.service";
import { SearchRateLimitGuard } from "../src/search/guards/search-rate-limit.guard";
import { createRedisClient } from "../src/database/redis.module";
@Module({}) class SearchRegressionModule {}
describe("W03: TC15/TC16 Search qua HTTP, khong co UC03", () => {
 const redis=createRedisClient();
 redis.on("error",()=>{});
 const eventIds:string[]=[];
 const category=`w03-${randomUUID().slice(0,8)}`;
 let userId:string, profileId:string, low:string, high:string, tie:string;
 let app:NestFastifyApplication, baseUrl:string;
 async function request(path:string) {
  const response=await fetch(baseUrl+path,{signal:AbortSignal.timeout(5000)});
  return {status:response.status,body:await response.json()};
 }
 before(async()=>{
  assert.match(new URL(env.DATABASE_URL).pathname, /_test$/);
  if(redis.status!=="ready") await new Promise<void>((resolve,reject)=>{redis.once("ready",resolve);redis.once("error",reject)});
  const [u]=await db.insert(users).values({email:`${randomUUID()}@example.com`,fullName:"Search regression",passwordHash:"fixture",role:"ORGANIZER",status:"ACTIVE"}).returning();
  userId=u!.id;
  const [profile]=await db.insert(organizerProfiles).values({userId,organizationName:"Regression",taxCode:randomUUID(),representativeName:"Regression",businessLicenseUrl:"https://example.com/license"}).returning();
  profileId=profile!.id;
  for(const [index,title] of ["Giai dien","nhacviet","nhacviet"].entries()) {
   const [event]=await db.insert(events).values({organizerId:profileId,title,slug:randomUUID(),description:index===0?"nhacviet":"Mo ta",category,city:"Ha Noi",venueName:"Stage",venueAddress:"Ha Noi",bannerUrl:"https://example.com/banner",startTime:new Date(Date.now()+(index+1)*86400000),endTime:new Date(Date.now()+(index+2)*86400000),gateOpeningTime:new Date(),status:"PUBLISHED"}).returning();
   eventIds.push(event!.id);
  }
  [low,high,tie]=eventIds as [string,string,string];
  app=await NestFactory.create<NestFastifyApplication>({module:SearchRegressionModule,controllers:[SearchController],providers:[{provide:SearchService,useValue:new SearchService()},{provide:SearchRateLimitGuard,useValue:new SearchRateLimitGuard(redis)}]},new FastifyAdapter(),{logger:false});
  await app.listen(0,"127.0.0.1"); baseUrl=await app.getUrl();
 });
 after(async()=>{try{await app?.close();if(eventIds.length)await db.delete(events).where(inArray(events.id,eventIds));if(profileId)await db.delete(organizerProfiles).where(eq(organizerProfiles.id,profileId));if(userId)await db.delete(users).where(eq(users.id,userId));}finally{redis.disconnect();await sqlClient.end()}});
  it("TC16: keyword ngan/chi khoang trang bo qua full-text va giu bo loc", async () => {
    for (const keyword of ["x", " x ", "", "   ", "ế"]) {
      const result = await request(
        `/api/v1/search/events?category=${category}&keyword=${encodeURIComponent(keyword)}`,
      );
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.deepEqual(
        result.body.data.items.map((e: { id: string }) => e.id),
        [low, high, tie],
      );
    }
    const filtered = await request(
      `/api/v1/search/events?category=${category}&keyword=x&city=Da%20Nang`,
    );
    assert.equal(filtered.body.data.items.length, 0);
  });

  it("TC15: uu tien ts_rank, tie-break ngay/ID va cursor khong mat/trung ket qua", async () => {
    const path = `/api/v1/search/events?category=${category}&keyword=nhacviet`;
    const result = await request(path);
    assert.deepEqual(
      result.body.data.items.map((e: { id: string }) => e.id),
      [high, tie, low],
    );
    const ids: string[] = [];
    let cursor = "";
    do {
      const page = await request(
        `${path}&limit=1${cursor ? `&cursor=${cursor}` : ""}`,
      );
      assert.equal(page.status, 200);
      ids.push(...page.body.data.items.map((e: { id: string }) => e.id));
      cursor = page.body.data.nextCursor;
    } while (cursor);
    assert.deepEqual(ids, [high, tie, low]);
  });

});
