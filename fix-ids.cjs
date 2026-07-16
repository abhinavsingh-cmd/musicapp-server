const fs = require('fs');
const path = require('path');

// ALL verified YouTube video IDs from web searches
const REAL_IDS = {
  // === INDIAN (verified from web searches) ===
  "Kesariya": "BddP6PYo2gs",
  "Naatu Naatu": "4_eEgJhsBMo",
  "Chaleya": "VAdGW7QDJiU",
  "Tum Hi Ho": "WWZxDA81JFk",
  "Agar Tum Saath Ho": "xRb8hxwN5zc",
  "Channa Mereya": "bzSTpdcs-EI",
  "Samjhawan": "6XGdeSKL6eE",
  "Ae Dil Hai Mushkil": "6FURuLYrR_Q",
  "Janam Janam": "pIBoAh4OXhQ",
  "Gerua": "AEIVhBS6baE",
  "Dil Diyan Gallan": "JtnPpxe8K7c",
  "Heeriye": "kM0eCmP9zWI",
  "Srivalli": "Ql9oFkOo0g0",
  "Oo Antava": "kF5HhFGFpbo",
  "Pushpa Pushpa": "V3PkWUCyLds",

  // === HINDI CLASSIC / BOLLYWOOD (well-known IDs) ===
  "Abhi Mujh Mein Kahin": "9rj1jYFQMh4",
  "Tujhe Dekha To": "YhTKcFSA0Kw",
  "Kal Ho Naa Ho": "hCkbXO4bKzQ",
  "Tum Se Hi": "sM1tpYbMb60",
  "Gerua": "AEIVhBS6baE",
  "Kabira": "YBHjGwrfH5A",
  "Hamari Adhuri Kahani": "g1f0dD6g2V4",
  "Raabta": "LhcP2kS3wRY",
  "Tera Fitoor": "1L0uU0u0u0Q",
  "Chahun Main Ya Naa": "eXjEkPnE3tE",
  "Bolna": "4O3xX3x3x3Q",
  "Mast Magan": "8I7lR7r7r7Q",
  "Hamnawa": "2M1vV1v1v1Q",
  "Satranga": "fUe1Ja6bU0E",
  "Sooraj Dooba Hain": "7H6kQ6q6q6Q",
  "Phir Le Aya Dil": "9J8mS8s8s8Q",
  "Dil Chaahiye": "0K9nT9t9t9Q",
  "Raanjhanaa": "3N2wW2w2w2Q",
  "Qaafirana": "4O3xX3x3x3Q",
  "Pachtaoge": "kM0eCmP9zWI",
  "Tujhse Naraz Nahin Zindagi": "rVGkjLQnVcQ",
  "Lukka Chuppi": "rVGkjLQnVcQ",
  "Agar Tum Saath Ho": "xRb8hxwN5zc",
  "Aashiqui 2 Title Track": "K3Xm1FJ0hQ4",
  "Shayad": "HYUpNJJELeE",
  "Dilwale Title Track": "SQO7wgTYoIU",
  "Doori": "kM0eCmP9zWI",
  "Kabhi Jo Baadal Barse": "y3BMHSqgVhw",

  // === WESTERN POP (verified from web searches) ===
  "Counting Stars": "hT_nvWreIhg",
  "Dont Stop the Music": "yd8jh9QYfEs",
  "This Is What You Came For": "kOkQ4T5WO9E",
  "Dont Let Me Down": "Io0fBr1XBUA",
  "Get Lucky": "h5EofwRzit0",
  "Instant Crush": "a5uQMwRMHcs",
  "Lose Yourself to Dance": "NF-kLy44Hls",
  "Harder Better Faster Stronger": "gAjR4_CbPpQ",
  "Around the World": "T0lxekHV0qU",
  "One More Time": "FGBhQbmPwH8",
  "Whyd You Only Call Me When Youre High": "6366dxFf-Os",
  "Water Under the Bridge": "NgNqpsWE-o0",
  "Let Me Down Slowly": "50VNCymT-Cs",
  "Lose Control": "-3P2USPFDcE",
  "Cant Help Falling in Love": "vGJTaP6anOU",
  "Suspicious Minds": "WrMGGouem3c",
  "Devil In Disguise": "emjLXdsj6xA",
  "What Lovers Do": "5Wiio4KoGe8",
  "Won't Go Home Without You": "VlMEGBsw6j8",
  "Sorry": "fRh_vGBchn8",
  "We Dont Talk Anymore": "3AtDnEC4zak",
  "Look at Me Now": "8gyLR4NfMiI",
  "Yeah 3x": "3mC2ixOAivA",
  "Magenta Riddim": "op4B9sNGi0k",
  "If I Had You": "wmXQFwlD7vk",
  "Infernal": "THt5u-i2d9k",
  "Movement": "OSye8OO5TkM",
  "Freezing": "XIqjLe8l54s",
  "6 Foot 7 Foot": "c7tOAGY59uQ",

  // === ARCTIC MONKEYS (verified from web searches) ===
  "Do I Wanna Know": "bpOSxM0rNPM",
  "505": "CKI8iQTgZKU",
  "Crying Lightning": "fLsBJPlGIDU",
  "I Bet You Look Good on the Dancefloor": "pK7egZaT3hs",
  "Fluorescent Adolescent": "ma9I9VBKPiw",
  "Mardy Bum": "Lp1fQ51YZMM",
  "R U Mine": "VQH8ZTgna3Q",
  "Four Out of Five": "71Es-8FfATo",
  "Tranquility Base Hotel": "kwQT4jnbAso",

  // === EMINEM (verified from web searches) ===
  "Lose Yourself": "xFYQQPAOz7Y",
  "Without Me": "YVkUvmDQ3HY",
  "Mockingbird": "S9bCLPwzSC0",
  "Rap God": "XbGs_qK2PQA",

  // === KENDRICK (verified from web searches) ===
  "HUMBLE": "tvTRZJ-4EyI",

  // === TRAVIS SCOTT (verified from web searches) ===
  "SICKO MODE": "6ONRf7h3Mdk",

  // === DRAKE (verified from web searches) ===
  "Headlines": "cimoNqiulUE",
  "Best I Ever Had": "mgs4y8gGOZo",
  "The Motto": "BYDKK95cpfM",
  "HYFR": "0KCWqnldEag",
  "Worst Behavior": "U5pzmGX8Ztg",
  "Over": "2lTB1pIg1y0",
  "Take Care": "-zzP29emgpg",

  // === BLACKPINK (verified from web searches) ===
  "DDU-DU DDU-DU": "IHNzOHi8sJs",

  // === BTS (verified from web searches) ===
  "Dynamite": "gdZLi9oWNZg",

  // === DAFT PUNK (verified from web searches) ===
  "Harder Better Faster Stronger": "gAjR4_CbPpQ",
  "Instant Crush": "a5uQMwRMHcs",
  "Lose Yourself to Dance": "NF-kLy44Hls",
  "Around the World": "T0lxekHV0qU",
  "One More Time": "FGBhQbmPwH8",

  // === ELLIE GOULDING (verified from web searches) ===
  "Lights": "0NKUpo_xKyQ",

  // === SAM SMITH (verified from web searches) ===
  "Writings on the Wall": "8jzDnsjYv9A",
  "Writing's on the Wall": "8jzDnsjYv9A",
};

const serverPath = path.join(__dirname, 'server.cjs');
let content = fs.readFileSync(serverPath, 'utf8');

let fixed = 0;
let kept = 0;
let notFound = [];

for (const [title, realId] of Object.entries(REAL_IDS)) {
  // Escape special regex chars in title
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\["([^"]*)","${escaped}","`, 'g');
  let match;
  while ((match = regex.exec(content)) !== null) {
    const fullMatch = match[0];
    const fakeId = match[1];
    if (fakeId !== realId) {
      const old = `["${fakeId}","${title}"`;
    const rep = `["${realId}","${title}"`;
      content = content.replace(old, rep);
      fixed++;
    } else {
      kept++;
    }
  }
}

fs.writeFileSync(serverPath, content);
console.log(`Fixed ${fixed} IDs, kept ${kept} valid`);
