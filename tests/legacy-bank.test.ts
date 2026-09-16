import request from "supertest";
import { describe, expect, it } from "vitest";
import { createLegacyBankApp } from "../demo/legacy-bank/app.js";

const app = createLegacyBankApp();

describe("LegacyBank Admin Simulator", () => {
  it("serves a normal member and framed savings balance", async () => {
    const member = await request(app).get("/members/search?member_id=12345").expect(200);
    expect(member.text).toContain("Member Details");
    expect(member.text).toContain('title="Member accounts"');

    const accounts = await request(app).get("/members/12345/accounts").expect(200);
    expect(accounts.text).toContain('data-field="current-balance">$12,340.22');
  });

  it.each([
    ["40400", 404, "MEMBER_NOT_FOUND"],
    ["40300", 403, "PERMISSION_DENIED"],
    ["50000", 500, "APP_ERROR"],
  ])("maps member %s to HTTP %s and code %s", async (memberId, status, code) => {
    const response = await request(app).get(`/members/search?member_id=${memberId}`).expect(status);
    expect(response.text).toContain(code);
  });

  it("renders an accessible unexpected modal for handoff", async () => {
    const response = await request(app).get("/members/search?member_id=88888").expect(200);
    expect(response.text).toContain('role="dialog"');
    expect(response.text).toContain("Acknowledge and Continue");
    expect(response.text).toContain("Morgan Modal");
  });

  it("uses a distinct fake member record for the delayed scenario", async () => {
    const response = await request(app).get("/members/search?member_id=70000").expect(200);
    expect(response.text).toContain("Taylor Training");
    expect(response.text).toContain("/members/70000/accounts");
  });

  it("stops sub-account creation at review", async () => {
    const response = await request(app)
      .post("/members/12345/sub-account/review")
      .type("form")
      .send({ account_type: "holiday_savings", nickname: "Winter" })
      .expect(200);
    expect(response.text).toContain("No Changes Submitted");
    expect(response.text).not.toContain("Confirm and Open");
  });
});
