// Phone number + address checks, shared by the chat, the dashboard and the server.
//
// Phone: Indian mobile = 10 digits starting 6/7/8/9. Accepts +91, 91 or 0 in front,
//        spaces and dashes. Rejects wrong length, wrong first digit and obvious fakes.
// Address: pincode must be 6 digits and real-looking; its region must match any city
//        the customer wrote; there should be a door / house number.
//        Offline this uses the pincode's first digits. The server can also confirm the
//        pincode with India Post (see /api/pincode in server.mjs).

(function () {
  // First two digits of a PIN → state (India Post postal circles)
  const PIN_STATE = [
    [11, 11, "Delhi"], [12, 13, "Haryana"], [14, 15, "Punjab"], [16, 16, "Punjab / Chandigarh"],
    [17, 17, "Himachal Pradesh"], [18, 19, "Jammu & Kashmir"], [20, 28, "Uttar Pradesh / Uttarakhand"],
    [30, 34, "Rajasthan"], [36, 39, "Gujarat"], [40, 44, "Maharashtra / Goa"], [45, 48, "Madhya Pradesh"],
    [49, 49, "Chhattisgarh"], [50, 50, "Telangana"], [51, 53, "Andhra Pradesh"], [56, 59, "Karnataka"],
    [60, 64, "Tamil Nadu"], [67, 69, "Kerala"], [70, 74, "West Bengal"], [75, 77, "Odisha"],
    [78, 78, "Assam"], [79, 79, "North East"], [80, 85, "Bihar / Jharkhand"],
  ];
  // First three digits → area, for Tamil Nadu (most of the shop's orders)
  const TN_AREA = {
    600: "Chennai", 601: "Chennai", 602: "Tiruvallur", 603: "Chengalpattu", 604: "Villupuram", 605: "Villupuram / Puducherry",
    606: "Tiruvannamalai", 607: "Cuddalore", 608: "Cuddalore", 609: "Nagapattinam", 610: "Tiruvarur", 611: "Nagapattinam",
    612: "Thanjavur", 613: "Thanjavur", 614: "Thanjavur", 620: "Tiruchirappalli", 621: "Tiruchirappalli / Perambalur",
    622: "Pudukkottai", 623: "Ramanathapuram", 624: "Dindigul", 625: "Madurai / Theni", 626: "Virudhunagar",
    627: "Tirunelveli", 628: "Thoothukudi", 629: "Kanyakumari", 630: "Sivaganga", 631: "Kanchipuram / Ranipet",
    632: "Vellore", 635: "Krishnagiri / Dharmapuri", 636: "Salem", 637: "Namakkal", 638: "Erode", 639: "Karur",
    641: "Coimbatore / Tiruppur", 642: "Pollachi / Coimbatore", 643: "Nilgiris",
  };
  // Cities customers often write → the PIN prefixes they belong to
  const CITY = {
    coimbatore: ["641", "642"], kovai: ["641", "642"], tiruppur: ["641", "638"], tirupur: ["641", "638"], pollachi: ["642"],
    chennai: ["600", "601", "602", "603"], madurai: ["625"], trichy: ["620", "621"], tiruchirappalli: ["620", "621"],
    salem: ["636"], erode: ["638"], vellore: ["632"], thanjavur: ["612", "613", "614"], karur: ["639"], namakkal: ["637"],
    dindigul: ["624"], ooty: ["643"], hosur: ["635"], tirunelveli: ["627"], nagercoil: ["629"], thoothukudi: ["628"],
    bangalore: ["560", "561", "562"], bengaluru: ["560", "561", "562"], mysore: ["570"], mysuru: ["570"],
    kochi: ["682", "683"], palakkad: ["678"], trivandrum: ["695"], thiruvananthapuram: ["695"],
    hyderabad: ["500", "501", "502"], mumbai: ["400", "401"], pune: ["411", "412"], delhi: ["110"], kolkata: ["700", "711", "712"],
  };

  function stateOf(pin) {
    const two = Number(pin.slice(0, 2));
    const row = PIN_STATE.find(([lo, hi]) => two >= lo && two <= hi);
    return row ? row[2] : null;
  }

  // ── phone ────────────────────────────────────────────────
  function checkPhone(text) {
    const runs = String(text || "").match(/\+?\d[\d\s-]{6,16}\d/g) || [];
    let firstProblem = null;
    for (const run of runs) {
      let d = run.replace(/\D/g, "");
      if (d.length === 6) continue; // a pincode, not a phone
      if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
      else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
      if (d.length !== 10) {
        firstProblem = firstProblem || { ok: false, digits: d, reason: `has ${d.length} digits` };
        continue;
      }
      if (!/^[6-9]/.test(d)) {
        firstProblem = firstProblem || { ok: false, digits: d, reason: `starts with ${d[0]}` };
        continue;
      }
      if (/^(\d)\1{9}$/.test(d) || d === "1234567890") {
        firstProblem = firstProblem || { ok: false, digits: d, reason: "looks like a dummy number" };
        continue;
      }
      return { ok: true, phone: d, pretty: `${d.slice(0, 5)} ${d.slice(5)}` };
    }
    return firstProblem || { ok: false, missing: true, reason: "no phone number found" };
  }

  // ── pincode ──────────────────────────────────────────────
  function checkPincode(pin) {
    pin = String(pin || "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(pin)) return { ok: false, pin, reason: "a pincode has 6 digits" };
    if (pin[0] === "0") return { ok: false, pin, reason: "pincodes don't start with 0" };
    const state = stateOf(pin);
    if (!state) return { ok: false, pin, reason: "this pincode doesn't belong to any state" };
    const area = TN_AREA[Number(pin.slice(0, 3))] || null;
    return { ok: true, pin, state, area };
  }

  // ── full address ─────────────────────────────────────────
  function checkAddress(raw, opts = {}) {
    const text = String(raw || "");
    const lower = text.toLowerCase();
    const flags = [];
    const pinM = text.match(/(?:^|\D)(\d{6})(?!\d)/) || text.match(/(?:^|\D)(\d{3})\s(\d{3})(?!\d)/);
    const pinRaw = pinM ? (pinM[2] ? pinM[1] + pinM[2] : pinM[1]) : null;
    const pin = pinRaw ? checkPincode(pinRaw) : null;
    if (!pin) flags.push("Pincode missing");
    else if (!pin.ok) flags.push(`Pincode ${pin.pin}: ${pin.reason}`);

    // City written in the address vs the pincode's region
    let city = null;
    let cityMatch = null;
    for (const [name, prefixes] of Object.entries(CITY)) {
      if (new RegExp(`\\b${name}\\b`).test(lower)) {
        city = name[0].toUpperCase() + name.slice(1);
        if (pin && pin.ok) cityMatch = prefixes.some((p) => pin.pin.startsWith(p));
        break;
      }
    }
    if (cityMatch === false) flags.push(`Pincode ${pin.pin} is in ${pin.area || pin.state}, but the address says ${city}`);

    // Door / house number: a number left after removing phone and pincode
    let rest = text;
    if (opts.phone) rest = rest.replace(new RegExp(opts.phone.split("").join("[\\s-]?")), " ");
    rest = rest.replace(/\+?\d[\d\s-]{8,14}\d/g, " ");
    if (pinRaw) rest = rest.replace(pinRaw, " ").replace(pinRaw.slice(0, 3) + " " + pinRaw.slice(3), " ");
    const hasDoor = /\d/.test(rest) || /\b(door|flat|plot|house|no\.?)\b/i.test(rest);
    if (!hasDoor) flags.push("No door / house number");

    const words = rest.replace(opts.name || "", " ").split(/[\s,]+/).filter((w) => /[a-z]/i.test(w));
    if (words.length < 2) flags.push("Address looks too short");

    return {
      ok: flags.length === 0,
      pincode: pin && pin.ok ? pin.pin : pinRaw,
      pinOk: !!(pin && pin.ok),
      state: pin && pin.ok ? pin.state : null,
      area: pin && pin.ok ? pin.area : null,
      city,
      cityMatch,
      hasDoor,
      flags,
    };
  }

  globalThis.AW33Validate = { checkPhone, checkPincode, checkAddress };
})();
