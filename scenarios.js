// Ready-made customer conversations for recording the demo.
// Each step is what the "customer" types. `share` attaches one of the shop's posts.
// Written the way people actually DM: lowercase, short, a bit messy.

globalThis.AW33_SCENARIOS = [
  {
    id: "f1",
    label: "F1 jersey → order booked",
    steps: [
      { text: "F1 jersey" },
      { text: "Ferrari or mercedes" },
      { text: "ferrari M size" },
      { text: "ok book it" },
      { text: "Karthik, 9876543210, 12 Gandhi St, RS Puram, Coimbatore 641002" },
      { text: "cod" },
    ],
  },
  {
    id: "reel",
    label: "Shared reel + \"Price??\"",
    steps: [
      { share: "fb-realmadrid", text: "Price??" },
      { text: "L iruka" },
      { text: "player version" },
      { text: "name and number venum" },
      { text: "mbappe 10" },
      { text: "ok book pannunga" },
      { text: "Priya, 9876500000, 4/21 Anna Nagar, Madurai 625020" },
      { text: "gpay" },
      { pay: "Google Pay" },
    ],
  },
  {
    id: "checks",
    label: "Wrong number + pincode fixed",
    steps: [
      { text: "portugal jersey L size fan version" },
      { text: "book it" },
      { text: "Ravi, 98765 4321, 5 MG Road, Bangalore 641002" },
      { text: "sorry 9876512345" },
      { text: "560038" },
      { text: "cod" },
    ],
  },
  {
    id: "tanglish",
    label: "Tanglish, 4 questions in 1",
    steps: [
      { text: "anna argentina jersey iruka? XL size. evlo? cod available ah" },
      { text: "player version venum anna" },
    ],
  },
  {
    id: "boots",
    label: "Boots + store visit",
    steps: [{ text: "bro where is your shop? can i come tomorrow and try predator boots uk 9" }],
  },
  {
    id: "size",
    label: "Size help",
    steps: [
      { text: "im 5'9 and 72 kg which size for lakers jersey" },
      { text: "lebron" },
      { text: "set with shorts" },
    ],
  },
  {
    id: "team",
    label: "Team kit enquiry",
    steps: [
      { text: "Hi, we need 15 football jerseys for our college team with names and numbers" },
      { text: "own design, we have our logo" },
      { text: "need it by 20th nov" },
      { text: "Kovai Strikers FC, Arun" },
    ],
  },
  {
    id: "offer",
    label: "Diwali offer",
    steps: [{ text: "any diwali offer on jerseys?" }, { text: "club jerseys" }],
  },
  {
    id: "complaint",
    label: "Complaint → team",
    steps: [{ text: "I received wrong size yesterday, ordered L but got M. need exchange" }],
  },
];

// The full sequence for the video.
globalThis.AW33_FULL_DEMO = ["reel", "f1", "team", "complaint"];
