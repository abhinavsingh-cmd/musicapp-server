process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught exception:", err.message || err);
});

const express = require("express");
const cors = require("cors");
const { execFile, spawn } = require("child_process");
const path = require("path");
const os = require("os");
const app = express();
app.use(cors());
app.use(express.json());

const SONGS = [
  ["kN6HHzEXKFU","Pushpa Pushpa","Devi Sri Prasad","Indian",230],
  ["BddP6PYo2gs","Kesariya","Arijit Singh","Indian",268],
  ["u_wB6byrl5k","Oo Antava","Devi Sri Prasad","Indian",226],
  ["VAdGW7QDJiU","Chaleya","Arijit Singh","Indian",231],
  ["hcMzwMrr1tE","Srivalli","Javed Ali","Indian",228],
  ["vdY5SFZBgnk","Saami Saami","Rashmika Mandanna","Indian",213],
  ["WWZxDA81JFk","Tum Hi Ho","Arijit Singh","Indian",262],
  ["f3FFOBrMmdg","Hamari Adhuri Kahani","Arijit Singh","Indian",253],
  ["284Ov7ysmfA","Channa Mereya","Arijit Singh","Indian",279],
  ["xRb8hxwN5zc","Agar Tum Saath Ho","Arijit Singh","Indian",332],
  ["pIBoAh4OXhQ","Janam Janam","Arijit Singh","Indian",264],
  ["p8eD8PQcC8I","Kabhi Jo Baadal Barse","Arijit Singh","Indian",284],
  ["BlZjTxPAmKc","Naina","Diljit Dosanjh","Indian",180],
  ["AEIVhBS6baE","Gerua","Arijit Singh","Indian",336],
  ["HYUpNJJELeE","Shayad","Arijit Singh","Indian",250],
  ["yt4-qlU__iM","Chandigarh Mein","Badshah","Indian",195],
  ["aDFEb_W2t1Y","Pal","Arijit Singh","Indian",295],
  ["JGwWNGJdvx8","Shape of You","Ed Sheeran","Pop",234],
  ["3rWL1mavaKQ","Zaalim","Badshah","Indian",195],
  ["CevxZvSJLk8","Roar","Katy Perry","Pop",223],
  ["OPf0YbXqDm0","Finesse","Bruno Mars","Pop",200],
  ["LXb3EKWsInQ","Calm Down","Rema","Afrobeats",219],
  ["9rKEebGi6Io","Chumma","Pawan Singh","Indian",155],
  ["hT_nvWreIhg","Counting Stars","OneRepublic","Pop",257],
  ["dQw4w9WgXcQ","Never Gonna Give You Up","Rick Astley","Pop",213],
  ["e-ORhEE9VVg","Thank U Next","Ariana Grande","Pop",207],
  ["sVx1mJDeUjY","New Rules","Dua Lipa","Pop",199],
  ["kJQP7kiw5Fk","Despacito","Luis Fonsi","Latin",228],
  ["kffacxfA7G4","Baby","Justin Bieber","Pop",214],
  ["nfWlot6h_JM","Shallow","Lady Gaga","Pop",216],
  ["BmllggGO4pM","Senorita","Shawn Mendes","Pop",191],
  ["QYh6mYIJG2Y","What Makes You Beautiful","One Direction","Pop",217],
  ["4NRXx6U8ABQ","Save Your Tears","The Weeknd","Pop",215],
  ["50VNCymT-Cs","Let Me Down Slowly","Alec Benjamin","Pop",157],
  ["VlMEGBsw6j8","Won't Go Home Without You","Maroon 5","Pop",227],
  ["WrMGGouem3c","Suspicious Minds","Elvis Presley","Rock",219],
  ["emjLXdsj6xA","Devil In Disguise","Elvis Presley","Rock",146],
  ["3mC2ixOAivA","Yeah 3x","Chris Brown","Pop",242],
  ["0NKUpo_xKyQ","Lights","Ellie Goulding","Pop",255],
  ["mgs4y8gGOZo","Best I Ever Had","Drake","Hip Hop",223],
  ["cimoNqiulUE","Headlines","Drake","Hip Hop",238],
  ["60ItHLz5WEA","Faded","Alan Walker","Electronic",262],
  ["NF-kLy44Hls","Lose Yourself to Dance","Daft Punk","Electronic",353],
  ["cs1e0fRyI18","Hawayein","Arijit Singh","Indian",177],
  ["6XGdeSKL6eE","Samjhawan","Arijit Singh","Indian",254],
  ["4_eEgJhsBMo","Naatu Naatu","Rahul Sipligunj","Indian",211],
  ["JtnPpxe8K7c","Dil Diyan Gallan","Atif Aslam","Indian",244],
  ["Nnop2walGmM","Tum Se","Sachin-Jigar","Indian",262],
  ["09R8_2nJtjg","Sugar","Maroon 5","Pop",235],
  ["kTJczUoc26U","Apna Bana Le","Arijit Singh","Indian",236],
  ["6FURuLYrR_Q","Ae Dil Hai Mushkil","Arijit Singh","Indian",282],
  ["2Vv-BfVoq4g","Uptown Funk","Bruno Mars","Pop",270],
  ["7PCkvCPvDXk","Cheap Thrills","Sia","Pop",225],
  ["5qap5aO4i9A","drivers license","Olivia Rodrigo","Pop",242],
  ["H5v3kku4y6Q","Watermelon Sugar","Harry Styles","Pop",174],
  ["AgX2II9si7w","Tujhe Kitna Chahne Lage","Arijit Singh","Indian",218],
  ["fJ9rUzIMcZQ","Bohemian Rhapsody","Queen","Rock",354],
  ["pBk4NYhWNMM","Done for Me","Charlie Puth","Pop",180],
  ["U5pzmGX8Ztg","Worst Behavior","Drake","Hip Hop",255],
  ["gdZLi9oWNZg","Dynamite","BTS","K-Pop",199],
  ["a5uQMwRMHcs","Instant Crush","Daft Punk","Electronic",337],
  ["gAjR4_CbPpQ","Harder Better Faster Stronger","Daft Punk","Electronic",224],
  ["FGBhQbmPwH8","One More Time","Daft Punk","Electronic",320],
  ["kwQT4jnbAso","Tranquility Base Hotel","Arctic Monkeys","Indie",211],
  ["OSye8OO5TkM","Movement","Hozier","Pop",234],
  ["8gyLR4NfMiI","Look At Me Now","Chris Brown","Hip Hop",201],
  ["vGJTaP6anOU","Cant Help Falling in Love","Elvis Presley","Rock",182],
  ["3AtDnEC4zak","We Dont Talk Anymore","Charlie Puth","Pop",218],
  ["DyDfgMOUjCI","Rocket Man","Elton John","Pop",281],
  ["hLQl3WQQoQ0","Someone Like You","Adele","Pop",285],
  ["L_jWHffIx5E","Smells Like Teen Spirit","Nirvana","Rock",301],
  ["tvTRZJ-4EyI","HUMBLE","Kendrick Lamar","Hip Hop",177],
  ["bpOSxM0rNPM","Do I Wanna Know","Arctic Monkeys","Indie",272],
  ["4m1EFMoRFvY","S&M","Rihanna","Pop",210],
  ["XbGs_qK2PQA","Rap God","Eminem","Hip Hop",363],
  ["VQH8ZTgna3Q","R U Mine","Arctic Monkeys","Indie",198],
  ["S9bCLPwzSC0","Mockingbird","Eminem","Hip Hop",250],
  ["0KCWqnldEag","HYFR","Drake","Hip Hop",250],
  ["xFYQQPAOz7Y","Lose Yourself","Eminem","Hip Hop",326],
  ["2lTB1pIg1y0","Over","Drake","Hip Hop",242],
  ["T6eK-2OQtew","Not Like Us","Kendrick Lamar","Hip Hop",274],
  ["RgKAFK5djSk","See You Again","Wiz Khalifa","Hip Hop",237],
  ["c7tOAGY59uQ","6 Foot 7 Foot","Lil Wayne","Hip Hop",228],
  ["yd8jh9QYfEs","Dont Stop the Music","Rihanna","Pop",242],
  ["xpVfcZ0ZcFM","Gods Plan","Drake","Hip Hop",198],
  ["6ONRf7h3Mdk","SICKO MODE","Travis Scott","Hip Hop",312],
  ["BYDKK95cpfM","The Motto","Drake","Hip Hop",193],
  ["YVkUvmDQ3HY","Without Me","Eminem","Hip Hop",290],
  ["Io0fBr1XBUA","Dont Let Me Down","Chainsmokers","Electronic",211],
  ["-zzP29emgpg","Take Care","Drake","R&B",276],
  ["kOkQ4T5WO9E","This Is What You Came For","Calvin Harris","Electronic",211],
  ["DK_0jXPuIr0","Spring Day","BTS","K-Pop",282],
  ["IHNzOHi8sJs","DDU-DU DDU-DU","BLACKPINK","K-Pop",209],
  ["h5EofwRzit0","Get Lucky","Daft Punk","Electronic",369],
  ["T0lxekHV0qU","Around the World","Daft Punk","Electronic",428],
  ["op4B9sNGi0k","Magenta Riddim","DJ Snake","Electronic",192],
  ["CKI8iQTgZKU","505","Arctic Monkeys","Indie",254],
  ["6366dxFf-Os","Whyd You Only Call Me When Youre High","Arctic Monkeys","Indie",161],
  ["ma9I9VBKPiw","Fluorescent Adolescent","Arctic Monkeys","Indie",180],
  ["fLsBJPlGIDU","Crying Lightning","Arctic Monkeys","Indie",234],
  ["Lp1fQ51YZMM","Mardy Bum","Arctic Monkeys","Indie",158],
  ["71Es-8FfATo","Four Out of Five","Arctic Monkeys","Indie",310],
  ["pK7egZaT3hs","I Bet You Look Good on the Dancefloor","Arctic Monkeys","Indie",174],
  ["G7KNmW9a75Y","Flowers","Miley Cyrus","Pop",200],
  ["xWkqjXjD73E","Doctor (Work It Out)","Pharrell Williams","Pop",215],
  ["q0oGhx2JT1A","Alright","Victoria Monet","R&B",210],
  ["0M1UCYRZAtM","Why Why Why","Shawn Mendes","Pop",215],
  ["MPbUaIZAaeA","Monster","Justin Bieber","Pop",240],
  ["gLCM_T37Sbc","Nobody Knows","Shawn Mendes","Pop",200],
  ["r7__5jmJ-tA","Heart of Gold","Shawn Mendes","Pop",195],
  ["kfXy4W0aD40","Taras","Munjya","Indian",180],
  ["yom3HewJev4","Peelings","Pushpa 2","Indian",210],
  ["adGR0QNxs0w","Diamond Ni","Vijay","Indian",190],
  ["a-PAcmi5Kas","Payal Song","Yo Yo Honey Singh","Indian",185],
  ["BDJUDiLNdXw","Ghagra","Crew","Indian",200],
  ["zlj3moH745E","Doriye","Kartik Aaryan","Indian",210],
  ["H58vbez_m4E","Not Like Us","Kendrick Lamar","Hip Hop",274],
  ["22tVWwmTie8","Houdini","Eminem","Hip Hop",220],
  ["GXIDQp0gq6g","Coca Cola","Luka Chuppi","Indian",195],
  ["b1kbLwvqugk","Anti-Hero","Taylor Swift","Pop",200],
  ["tcYodQoapMg","positions","Ariana Grande","Pop",177],
  ["gl1aHhXnN1k","thank u next","Ariana Grande","Pop",207],
  ["238Z4YaAr1g","Texas Hold Em","Beyonce","Pop",230],
  ["CvBfHwUxHIk","Umbrella","Rihanna","Pop",260],
  ["lWA2pjMjpBs","Diamonds","Rihanna","Pop",225],
  ["lp-EO5I60KA","Thinking Out Loud","Ed Sheeran","Pop",281],
  ["34Na4j8AVgA","Starboy","The Weeknd","Pop",230],
  ["XXYlFuWEuKI","Less Than Zero","The Weeknd","Pop",215],
  ["ApXoWvfEYVU","Sunflower","Post Malone","Pop",158],
  ["wXhTHyIgQ_U","Circles","Post Malone","Pop",215],
  ["E07s5ZYygMg","Watermelon Sugar","Harry Styles","Pop",174],
  ["MSRcC626prw","Kill Bill","SZA","R&B",153],
  ["2p3zZoraK9g","Good Days","SZA","R&B",279],
  ["hdFDrjfW548","Shirt","SZA","R&B",220],
  ["uxpDa-c-4Mc","Hotline Bling","Drake","Hip Hop",267],
  ["PEGccV-NOm8","Bodak Yellow","Cardi B","Hip Hop",214],
  ["xTlNMmZKwpA","I Like It","Cardi B","Hip Hop",203],
  ["7PBYGu4Az8s","Body","Megan Thee Stallion","Hip Hop",180],
  ["CuklIb9d3fI","Permission to Dance","BTS","K-Pop",220],
  ["ioNng23DkIM","How You Like That","BLACKPINK","K-Pop",200],
  ["_EyZUTDAH0U","Butterfly Effect","Travis Scott","Hip Hop",230],
  ["Dst9gZkq1a8","Goosebumps","Travis Scott","Hip Hop",243],
  ["7wtfhZwyrcc","Believer","Imagine Dragons","Rock",214],
  ["aJOTlE1K90k","Girls Like You","Maroon 5","Pop",230],
  ["VPRjCeoBqrI","A Sky Full Of Stars","Coldplay","Pop",290],
  ["ru0K8uYEZWw","Cant Stop the Feeling","Justin Timberlake","Pop",230],
  ["je0roKRn3nY","Selfish","Justin Timberlake","Pop",230],
  ["Cr8K88UcO0s","Titi Me Pregunto","Bad Bunny","Latin",240],
  ["eJEKHdvntPI","Savage","Megan Thee Stallion","Hip Hop",160],
  ["ktvTqknDobU","Radioactive","Imagine Dragons","Rock",186],
  ["CD-E-LDc384","Enter Sandman","Metallica","Rock",331],
  ["yrtWLyp5gLI","Cuff It","Beyonce","Pop",232],
  ["ViwtNLUqkMY","Crazy In Love","Beyonce","R&B",236],
  ["HL1UzIK-flA","Work","Rihanna","Pop",260],
  ["tg00YEETFzg","We Found Love","Rihanna","Electronic",216],
  ["pa14VNsdSYM","Only Girl In The World","Rihanna","Pop",245],
  ["mWRsgZuwf_8","Demons","Imagine Dragons","Rock",236],
  ["9yT4F8hzykY","Chaiyya Chaiyya","A R Rahman","Indian",340],
  ["g0eO74UmRBs","Kal Ho Naa Ho","Shankar Mahadevan","Indian",330],
  ["l_MyUGq7pgs","Malhari","Vishal Dadlani","Indian",210],
  ["KBIq11mNB0I","Malang","Ved Sharma","Indian",230],
  ["qFkNATtc3mc","Ghungroo","Arijit Singh","Indian",220],
  ["V7LwfY5U5WI","Ranjha","B Praak","Indian",230],
  ["PgCliOxl41o","Manike Mage Hithe","Yohani","Indian",210],
  ["5Eqb_-j3FDA","Pasoori","Ali Sethi","Indian",230],
  ["sCbbMZ-q4-I","Lut Gaye","Jubin Nautiyal","Indian",230],
  ["TuUVVKVdZm4","Saiyaan","Kailash Kher","Indian",310],
  ["asYxxtiWUyw","Chogada","Darshan Raval","Indian",220],
  ["2mDCVzruYzQ","Butta Bomma","Armaan Malik","Indian",210],
  ["mQiiw7uRngk","Tera Ban Jaunga","Arijit Singh","Indian",240],
  ["MJyKN-8UncM","Shayad","Arijit Singh","Indian",250],
  ["_cPHiwPqbqo","Coca Cola","Luka Chuppi","Indian",195],
  ["hMy5za-m5Ew","Filhall","B Praak","Indian",240],
  ["PVxc5mIHVuQ","Pachtaoge","Arijit Singh","Indian",240],
  ["UGkLd1pxHQ0","Mere Rashke Qamar","Neha Kakkar","Indian",220],
  ["k4yXQkG2s1E","Kala Chashma","Baar Baar Dekho","Indian",230],
  ["udra3Mfw2oo","London Thumakda","Queen","Indian",260],
  ["jCEdTq3j-0U","Gallan Goodiyaan","Shankar Mahadevan","Indian",250],
  ["HgIW7P4dsXU","Nachde Ne Saare","Salim-Sulaiman","Indian",230],
  ["-sWXx1mbgtU","Kar Gayi Chull","Badshah","Indian",190],
  ["yDv0WSgXJVg","Senorita","Farhan Akhtar","Indian",280],
  ["adLGHcj_fmA","Leave The Door Open","Silk Sonic","R&B",240],
  ["SR6iYWJxHqs","Grenade","Bruno Mars","Pop",215],
  ["LjhCEhWiKXk","Just The Way You Are","Bruno Mars","Pop",220],
  ["UqyT8IEBkvY","24K Magic","Bruno Mars","Pop",226],
  ["SlPhMPnQ58k","Memories","Maroon 5","Pop",188],
  ["KRaWnd3LJfs","Payphone","Maroon 5","Pop",260],
  ["iEPTlhBmwRg","Moves Like Jagger","Maroon 5","Pop",232],
  ["yKNxeF4KMsY","Yellow","Coldplay","Pop",260],
  ["RB-RcX5DS5A","The Scientist","Coldplay","Pop",310],
  ["3lfnR7OhZY8","Higher Power","Coldplay","Pop",215],
  ["3YqPKLZF_WU","My Universe","Coldplay","Pop",220],
  ["tAGnKpE4NCI","Nothing Else Matters","Metallica","Rock",388],
  ["iz1rIp1-b-Y","Break My Soul","Beyonce","Pop",275],
  ["qFLhGq0060w","I Feel It Coming","The Weeknd","Pop",230],
  ["oq9AgxHvGjw","After Hours","The Weeknd","Pop",240],
  ["U9BwWKXjVaI","Nice For What","Drake","Hip Hop",220],
  ["lJTRVX9R5EA","Nonstop","Drake","Hip Hop",235],
  ["hcm55lU9knw","WAP","Cardi B","Hip Hop",235],
  ["iS1g8G_njx8","Into You","Ariana Grande","Pop",210],
  ["7C2z4GqqS5E","FAKE LOVE","BTS","K-Pop",240],
  ["ic8j13piAhQ","Cruel Summer","Taylor Swift","Pop",180],
  ["q0hyYWKXF0Q","Dance Monkey","Tones and I","Pop",210],
  ["C3lWwBslWqg","Say My Name","Destinys Child","R&B",260],
  ["1w7OgIMMRc4","November Rain","Guns N Roses","Rock",330],
  ["BciS5krYL80","Hotel California","Eagles","Rock",391],
  ["QkF3oxziUI4","Stairway To Heaven","Led Zeppelin","Rock",480],
  ["pRpeEdMmmQ0","Waka Waka","Shakira","Pop",230],
  ["fWNaR-rxAic","Call Me Maybe","Carly Rae Jepsen","Pop",193],
  ["hTWKbfoikeg","Smells Like Teen Spirit","Nirvana","Rock",301],
  ["KQetemT1sWc","Come As You Are","Nirvana","Rock",220],
  ["kXYiU_JCYtU","In The End","Linkin Park","Rock",216],
  ["0Bmhjf0rKe8","Dark Horse","Katy Perry","Pop",215],
  ["9bZkp7q19f0","Gangnam Style","Psy","Pop",254],
  ["RBumgq5yVrA","Let Her Go","Passenger","Pop",255],
  ["qrO4YZeyl0I","Bad Romance","Lady Gaga","Pop",295],
  ["YQHsXMglC9A","Shallow","Lady Gaga","Pop",216],
  ["k2qgadSvNyU","New Rules","Dua Lipa","Pop",199],
  ["0msLKwkaTJk","lovely","Billie Eilish","Pop",200],
  ["KIfYtDl4B2g","Numb","Linkin Park","Rock",195],
  ["gNi_6U5Pm_o","good 4 u","Olivia Rodrigo","Pop",178],
  ["2EwViQxSJJQ","Irreplaceable","Beyonce","R&B",230],
  ["dqRZDebPIGs","In Your Eyes","The Weeknd","Pop",210],
  ["TO-_3tck2tg","Bones","Imagine Dragons","Rock",210],
  ["UYwF-jdcVjY","Better Now","Post Malone","Hip Hop",230],
  ["TeccAtqd5K8","Run Away With Me","Carly Rae Jepsen","Pop",240],
  ["XVgCLQ_JQfU","HISS","Megan Thee Stallion","Hip Hop",200],
  ["n5LWsc-qCdA","Captain Hook","Megan Thee Stallion","Hip Hop",190],
  ["pkcJEvMcnEg","Lithium","Nirvana","Rock",250],
  ["RQ9BWndKEgs","Deja Vu","Beyonce","R&B",240],
  ["vWz9VN40nCA","Physical","Olivia Newton-John","Pop",230],
  ["qQuQ8zDxGh0","Plan B","Megan Thee Stallion","Hip Hop",200],
  ["5Wiio4KoGe8","What Lovers Do","Maroon 5","Pop",230],
  ["SviE5fHCV0c","Too Good to Say Goodbye","Bruno Mars","Pop",230],
  ["J---aiyznGQ","What Do You Mean","Justin Bieber","Pop",206],
  ["0i0lYwacN9o","Levitating","Dua Lipa","Pop",203],
  ["GZV5yMB5fu0","Dont Start Now","Dua Lipa","Pop",190],
  ["kXj-cEQIpAs","Break My Heart","Dua Lipa","Pop",222],
  ["r5m6ScpU0yY","Music for a Sushi Restaurant","Harry Styles","Pop",195],
  ["393C3pr2ioY","Wow","Post Malone","Hip Hop",147],
  ["Ao2GsXHMD_4","Seoul City","Jennie","K-Pop",195],
  ["cg2MY3F2iAk","Imaginary Playerz","Cardi B","Hip Hop",210],
  ["CiwMDFh_Rog","Music For a Sushi Restaurant","Harry Styles","Pop",195],
  ["G0JKdFjWkLA","Snowchild","The Weeknd","Pop",250],
  ["hsm4poTWjMs","WAP","Cardi B","Hip Hop",235],
  ["i8Zi1DM7iR4","Too Young","Post Malone","Hip Hop",230],
  ["ixkoVwKQaJg","Taki Taki","DJ Snake","Electronic",212],
  ["OdxSbc0ap-s","Mamushi","Megan Thee Stallion","Hip Hop",180],
  ["tCXGJQYZ9JA","Delicate","Taylor Swift","Pop",232],
  ["VuNIsY6JdUw","You Belong With Me","Taylor Swift","Pop",230],
  ["wIft-t-MQuE","Ready For It","Taylor Swift","Pop",208],
  ["uoHol5Dr_go","Running Wild","Jin","K-Pop",210],
  ["9nIOx-ezlzA","Ivy","Taylor Swift","Pop",260],
  ["IdneKLhsWOQ","Wildest Dreams","Taylor Swift","Pop",238],
  ["u9raS7-NisU","Daylight","Taylor Swift","Pop",295],
  ["LnavzVJctAw","Life Goes On","Oliver Tree","Pop",210],
  ["sluLx2JlLqw","When The Partys Over","Billie Eilish","Pop",196],
  ["G2nJPEDc02k","Levitating","Dua Lipa","Pop",203],
  ["VwLqWkW-ezc","DDU-DU DDU-DU","BLACKPINK","K-Pop",209],
  ["4fikvcuirtY","Shut Down","BLACKPINK","K-Pop",210],
  ["o4At7dMfsng","Lovesick Girls","BLACKPINK","K-Pop",220],
  ["ymaIzkXY8nQ","Butter (feat. Megan Thee Stallion)","BTS","K-Pop",210],
  ["Fc5CFpDEwDg","Spring Day","BTS","K-Pop",282],
  ["HEccCVGS7sE","Fake Love","BTS","K-Pop",240],
  ["Ir466ul_M8c","Dynamite","BTS","K-Pop",199],
  ["0JLRExeOH-k","I Love You","Salman Khan","Indian",250],
  ["JvmMpQjkTOg","Lovely","Billie Eilish","Pop",200],
  ["LD8eB4jeSt8","Everything I Wanted","Billie Eilish","Pop",240],
  ["oMUBHzCZwZo","Savage","Megan Thee Stallion","Hip Hop",160],
  ["QjbOd8u49IM","Brutal","Olivia Rodrigo","Pop",145],
  ["lmiwVomqdJw","Good 4 U","Olivia Rodrigo","Pop",178],
  ["MZv2MSQfZQc","Traitor","Olivia Rodrigo","Pop",225],
  ["yIvnvI0Mlpk","Happier","Olivia Rodrigo","Pop",240],
  ["slGYJfPtW7c","Blinding Lights","The Weeknd","Pop",200],
  ["26rLLPVaxuk","Love Story","Taylor Swift","Pop",230],
  ["30gbL44vjA8","Save Your Tears","The Weeknd","Pop",215],
  ["1j0X32t-Atg","Popular","The Weeknd","Pop",215],
  ["3phNMODIF_g","Physical","Dua Lipa","Pop",194],
  ["BveCyeYIq18","Break My Heart","Dua Lipa","Pop",222],
  ["4NV41ju9fpI","Watermelon Sugar","Harry Styles","Pop",174],
  ["_-ZVb0yWB2o","Pink Venom","BLACKPINK","K-Pop",200],
  ["HZIg5sQrPAM","Fortnight","Taylor Swift","Pop",230],
  ["Cofb0p9xYcw","Style","Taylor Swift","Pop",230],
  ["04tYkKUPPv4","LILAC","IU","K-Pop",220],
  ["Aft4AvyC0Bg","Shirt","SZA","R&B",220],
  ["JQbjS0_ZfJ0","All The Stars","Kendrick Lamar","Hip Hop",260],
  ["KdtKJg2X7mY","Northern Attitude","Hozier","Pop",200],
  ["saGYMhApaH8","Me Porto Bonito","Bad Bunny","Latin",230],
  ["YqvM837mHJM","Yonaguni","Bad Bunny","Latin",230],
  ["snj6EisD1LE","Stitches","Shawn Mendes","Pop",207],
  ["hVaqc_Ozklg","Dont","Ed Sheeran","Pop",215],
  ["FCil3qBQryU","Castle on the Hill","Ed Sheeran","Pop",260],
  ["Zvi05BzkzvQ","Photograph","Ed Sheeran","Pop",255],
  ["3sDLMktfqFM","Gasolina","Daddy Yankee","Latin",190],
  ["dHv1yxliohM","Heat Waves","Glass Animals","Indie",238],
  ["lE-GhpoL3c4","Sweater Weather","The Neighbourhood","Indie",240],
  ["IUulbUEHBXc","Beautiful Things","Benson Boone","Pop",180],
  ["liKg8xAPJEY","Slow It Down","Benson Boone","Pop",185],
  ["MFdYJHL_Kn4","Someone You Loved","Lewis Capaldi","Pop",182],
  ["njh0BSC103k","Before You Go","Lewis Capaldi","Pop",210],
  ["J-dGhMCQg5M","Eight","IU","K-Pop",220],
  ["g3r0o8ceqeY","Little Dark Age","MGMT","Indie",260],
  ["9zgm_l-YhAk","After Dark","Mr Kitty","Electronic",260],
  ["wu6H2i99KTc","Cupid","FIFTY FIFTY","K-Pop",180],
  ["9wUKhEgnllc","Hype Boy","NewJeans","K-Pop",185],
  ["1VAn7CX_omg","Attention","NewJeans","K-Pop",195],
  ["VOmIplFAGeg","Cookie","NewJeans","K-Pop",195],
  ["DF3R2NNSqp4","NewJeans","NewJeans","K-Pop",200],
  ["7NTa0o80PuM","God of Music","SEVENTEEN","K-Pop",210],
  ["nvh3rO8jzok","MAESTRO","SEVENTEEN","K-Pop",210],
  ["wEdFCd1FmpA","Spicy","aespa","K-Pop",200],
  ["wxD8rGA-geM","Supernova","aespa","K-Pop",200],
  ["C6CNvG89FcQ","OMG","Camila Cabello","Pop",210],
  ["4RQaSd9jRSE","Never Be The Same","Camila Cabello","Pop",225],
  ["9hPiN8xoRDs","Treat You Better","Shawn Mendes","Pop",208],
  ["GodO6kBK1m8","Always Been You","Shawn Mendes","Pop",200],
  ["QiinjaY1NRM","Gods Menu","Stray Kids","K-Pop",220],
  ["TQTlCHxyuu8","Gods Menu","Stray Kids","K-Pop",220],
  ["TsulQZDKM-g","Kill Bill","SZA","R&B",153],
  ["EyidGyxg4_4","Theres Nothing Holdin Me Back","Shawn Mendes","Pop",210],
  ["yUV9JwiQLog","6 AM","J Balvin","Latin",240],
  ["jAn_zglNauk","Dakiti","Bad Bunny","Latin",230],
  ["Y6P17Dagam4","Mi Gente","J Balvin","Latin",210],
  ["2Q4BmJCRnq8","Sing","Ed Sheeran","Pop",235],
  ["1iPx8uQZ1lA","Vivir Mi Vida","Marc Anthony","Latin",260],
  ["jPnmsRcA68E","MANIAC","Stray Kids","K-Pop",220],
  ["uw7xvfcKWVw","Case 143","Stray Kids","K-Pop",200],
  ["5anLPw0Efmo","My Immortal","Evanescence","Rock",260],
  ["BO7cFCVVPZI","Not Afraid","Eminem","Hip Hop",290],
  ["dvgZkm1xWPE","Viva La Vida","Coldplay","Pop",260],
  ["GG7fLOmlhYg","Smokin Out The Window","Silk Sonic","R&B",210],
  ["gOMhN-hfMtY","Stan","Eminem","Hip Hop",380],
  ["lgT1AidzRWM","Beautiful","Eminem","Hip Hop",360],
  ["nddTokI9hHY","Thank You For Loving Me","Bon Jovi","Rock",280],
  ["Um7pMggPnug","Chained To The Rhythm","Katy Perry","Pop",240],
  ["v2H4l9RpkwM","Breaking The Habit","Linkin Park","Rock",220],
  ["dMOhDyB_o4Q","Run Away With Me","Carly Rae Jepsen","Pop",240],
  ["4YFu4dvMHHY","Dumb","Nirvana","Rock",145],
  ["8SbUC-UaAxE","November Rain","Guns N Roses","Rock",330],
  ["A-bzqylNf08","We Will Rock You","Queen","Rock",120],
  ["dpif2shN0vg","What Ive Done","Linkin Park","Rock",225],
  ["I5BpPJfzaYw","In The End","Linkin Park","Rock",216],
  ["rC0qvmeorAY","Thats What I Like","Bruno Mars","Pop",210],
  ["MjvuZtCD5hE","Just The Way You Are","Bruno Mars","Pop",220],
  ["mRXOt95FXZU","Smells Like Teen Spirit","Nirvana","Rock",301],
  ["88rOo1IgyGM","November Rain","Guns N Roses","Rock",330],
  ["WozmyP8ueYA","You Give Love a Bad Name","Bon Jovi","Rock",220],
  ["OkOOLSYZNxw","Love the Way You Lie Part 2","Rihanna","Pop",290],
  ["EF5HZw0UeDk","Roar","Katy Perry","Pop",223],
  ["e-xA9mS3ZG4","Last Friday Night","Katy Perry","Pop",230],
  ["oRCz85wXwzw","Teenage Dream","Katy Perry","Pop",230],
  ["36TakgmC5hw","California Gurls","Katy Perry","Pop",230],
  ["QsIuNPJaT5Y","Swish Swish","Katy Perry","Pop",240],
  ["ZxevHIxy218","Witness","Katy Perry","Pop",250],
  ["iQPntUPNDlQ","Firework","Katy Perry","Pop",228],
  ["kVSXCphR6Ww","Part of Me","Katy Perry","Pop",215],
  ["fyjpMIRt7oE","Faint","Linkin Park","Rock",180],
  ["KCSgzF2uqyQ","Somewhere I Belong","Linkin Park","Rock",225],
  ["hDqmy39lkq4","Burn It Down","Linkin Park","Rock",210],
  ["2CyQfUdB4Zg","One Step Closer","Linkin Park","Rock",175],
  ["nG8TLHCXnbs","The Real Slim Shady","Eminem","Hip Hop",285],
  ["WboSNjFgVVs","Crawling","Linkin Park","Rock",215],
  ["Bne99CCPy_w","Superman","Eminem","Hip Hop",340],
  ["3AyMjyHu1bA","Intentions","Justin Bieber","Pop",220],
  ["3KLHlSmr7J4","Loba","Shakira","Pop",225],
  ["DuKn53qs5-4","Waka Waka","Shakira","Pop",230],
  ["F1BfcDHpzCk","If I Were A Boy","Beyonce","R&B",250],
  ["gdx7gN1UyX0","Company","Justin Bieber","Pop",210],
  ["hgnOXQfu-Ko","Hold Up","Beyonce","Pop",220],
  ["r8GXHS4s9K4","Telephone","Lady Gaga","Pop",230],
  ["WDZJPJV__bQ","Formation","Beyonce","Hip Hop",260],
  ["wJvppSr8BN4","Despacito","Luis Fonsi","Latin",228],
  ["rNM5HW13_O8","Diva","Beyonce","Hip Hop",210],
  ["OSAOsm1u-OE","7/11","Beyonce","Pop",200],
  ["Q0E4wVF2a4k","America Has a Problem","Beyonce","Pop",220],
  ["WQmYVfHrNxA","Jealous","Beyonce","R&B",230],
  ["adVyfjPYAAE","Flawless","Beyonce","Hip Hop",230],
  ["hbnPkK76Ask","Ego","Beyonce","R&B",240],
  ["EbCsIKI6HEU","Take On Me","a-ha","Pop",230],
  ["lExifYmpTis","Whenever Wherever","Shakira","Pop",215],
  ["QFK09y01me0","Never Gonna Give You Up","Rick Astley","Pop",213],
  ["aUycxurAc9g","Stay","The Kid LAROI","Pop",220],
  ["33I88MRSWYE","Diamonds","Rihanna","Pop",225],
  ["anhiSljnF2Q","Dont Stop The Music","Rihanna","Pop",242],
  ["dudMkExt1co","Only Girl In The World","Rihanna","Pop",245],
  ["9uZm3tHgjJg","Love The Way You Lie","Eminem","Hip Hop",265],
  ["lFVbDj_qlUU","Training Season","Dua Lipa","Pop",210],
  ["MncDnhEQ_q8","Illusion","Dua Lipa","Pop",205],
  ["w9uTc7_FB_0","Shake It Off","Taylor Swift","Pop",230],
  ["mDEiSrQ0fy4","Ocean Eyes","Billie Eilish","Pop",200],
  ["fKopy74weus","Thunder","Imagine Dragons","Rock",210],
  ["vt0i6nuqNEo","Popular","The Weeknd","Pop",215],
  ["3y-O-4IL-PU","Please Me","Cardi B","Hip Hop",210],
  ["d7OROxsW5ZY","Fat Juicy Wet","Sexyy Red","Hip Hop",180],
  ["PMivT7MJ41M","Thats What I Like","Bruno Mars","Pop",210],
  ["oC6fHbU_fvs","When I Was Your Man","Bruno Mars","Pop",215],
  ["pRSjF6W6WHY","Treasure","Bruno Mars","Pop",180],
  ["dElRVQFqj-k","Marry You","Bruno Mars","Pop",230],
  ["eo8TLKylGCI","Treasure","Bruno Mars","Pop",180],
  ["G90XgBqTpxc","Marry You","Bruno Mars","Pop",230],
  ["-cy_tDQPXHk","After Last Night","Silk Sonic","R&B",250],
  ["x5r9aU06Dp4","Blast Off","Silk Sonic","R&B",230],
  ["g49YiALanq4","Die With A Smile","Lady Gaga","Pop",260],
  ["1-B_QfX9IG0","Espresso","Sabrina Carpenter","Pop",175],
  ["XZ26s3b5tnk","Birds of a Feather","Billie Eilish","Pop",210],
  ["Wm3wOPtl-6I","Beautiful Things","Benson Boone","Pop",180],
  ["0lXz_kxYLlA","APT","ROSÉ","K-Pop",200],
  ["LQUfBkBkDoU","Manchild","Sabrina Carpenter","Pop",185],
  ["mhTiOYFF0wg","Messy","Lola Young","Pop",195],
  ["ncCvgg7M7uI","Sailor Song","Gigi Perez","Pop",200],
  ["tRyYzHAxmv0","Thats So True","Gracie Abrams","Pop",180],
  ["kzJkVSnZEGk","Abracadabra","Lady Gaga","Pop",210],
  ["aH7gkoBpN3s","End of Beginning","Djo","Indie",225],
  ["0NTDM_BM6mo","Too Sweet","Hozier","Pop",240],
  ["IRM3acZWmM0","Stargazing","Myles Smith","Pop",190],
  ["5GJWxDKyk3A","Happier Than Ever","Billie Eilish","Pop",258],
  ["9g513893B_Q","Ordinary","Alex Warren","Pop",200],
  ["lSu86ELwCIc","Daisies","Justin Bieber","Pop",195],
  ["GCa-YQ_CPVc","Earrings","Malcolm Todd","Pop",190],
  ["y-XDzyK8mkM","greedy","Tate McRae","Pop",170],
  ["zp8b9_Jd_z8","Not Like Us","Kendrick Lamar","Hip Hop",274],
  ["eMb4A5rsy_0","like JENNIE","JENNIE","K-Pop",185],
  ["Xngo1DiF_w4","Killin It Girl","J-Hope","K-Pop",190],
  ["UDaYOw22TYc","Dirty Work","aespa","K-Pop",195],
  ["VZqfV5rxAeo","Earthquake","JISOO","K-Pop",200],
  ["7Va8mJii9x4","Gnarly","KATSEYE","K-Pop",185],
  ["7WlhY42yzl0","Gnarly","KATSEYE","K-Pop",185],
  ["RpOA8weXxwc","Lemon Drop","ATEEZ","K-Pop",200],
  ["Z2L51xr45As","Hot","LE SSERAFIM","K-Pop",195],
  ["Tg7VGqlR95Y","Rebel Heart","IVE","K-Pop",200],
  ["NFEWUZMDHVU","Blue","ZEROBASEONE","K-Pop",205],
  ["o7BcyAd6rqg","Dont Say You Love Me","Jin","K-Pop",220],
  ["MYQWsdGahqc","Who","Jimin","K-Pop",210],
  ["YOI-t4Bf4tE","JUMP","BLACKPINK","K-Pop",200],
  ["2Y4zvxK0wYM","Baile Inolvidable","Bad Bunny","Latin",230],
  ["q7yL1OI8Zdk","DtMF","Bad Bunny","Latin",220],
  ["Xv-0NmXowvI","NUEVAYoL","Bad Bunny","Latin",215],
  ["wqLgrO9lI4M","Soltera","Shakira","Latin",205],
  ["zYg4Si410TQ","Si Antes Te Hubiera Conocido","Karol G","Latin",220],
  ["s6FiXlhFYJI","Turbulence","Wizkid","Afrobeats",210],
  ["hLDQ88vAhIs","City Boys","Burna Boy","Afrobeats",205],
  ["GEIeH7DfH38","Calm Down","Rema","Afrobeats",219],
  ["0KZgdVeywys","Aavan Jaavan","Arijit Singh","Indian",240],
  ["48GOe-HE5mw","Bijuria","Sonu Nigam","Indian",210],
  ["8SYPKQMW_2Q","Tum Ho Toh","Vishal Mishra","Indian",230],
  ["ldke2-Ys0Vk","Ishq Mein","Sachin-Jigar","Indian",220],
  ["t4mBEeAA1hU","Qayde Se","Arijit Singh","Indian",245],
  ["jcV7i0WM9jU","Lo Safar","Jubin Nautiyal","Indian",235],
  ["E3OkNii7S3k","Laal Pari","Housefull 5","Indian",210],
  ["8Kw2V4J2Tkk","Alakh Niranjan","Aadesh Krishna","Indian",300],
  ["wkpBEUm3Tvk","Alakh Niranjan Part 11","Aadesh Krishna","Indian",320],
  ["DH5oKK2KRsU","luther","Kendrick Lamar","Hip Hop",235],
  ["K3_Mx17DMeY","Anxiety","Doechii","Hip Hop",210],
  ["JPvv0fN9WSQ","Like That","Future","Hip Hop",280],
  ["69fvODvRZr8","A Bar Song (Tipsy)","Shaboozey","Hip Hop",195],
  ["1htsmJfS1nk","I Aint Coming Back","Morgan Wallen","Hip Hop",210],
  ["utKmvBd9D7s","Party 4 U","Charli XCX","Pop",200],
  ["wun9W1J7YbQ","Mutt","Leon Thomas","R&B",210],
  ["n-hK4QRGQe0","Pretty Little Baby","Connie Francis","Pop",150],
  ["2kjolTLZ_Mg","Sao Paulo","The Weeknd","Pop",210],
  ["ba7mB8oueCY","Goodbyes","Post Malone","Hip Hop",180],
  ["JLyTfOZp8oM","Take On Me","a-ha","Pop",225],
  ["juw828glgqE","Save Your Tears","The Weeknd","Pop",215],
  ["Nj2U6rhnucI","Break My Heart","Dua Lipa","Pop",220],
  ["uJ_1HMAGb4k","Riptide","Vance Joy","Indie",215],
  ["VF-r5TtlT9w","Adore You","Harry Styles","Pop",207],
  ["WpMzXJYQoWE","Watermelon Sugar","Harry Styles","Pop",174],
  ["xpN3GRFKb4w","Billie Jean","Michael Jackson","Pop",294],
  ["h8DLofLM7No","Lavender Haze","Taylor Swift","Pop",200],
  ["8jrRTLtlzks","Levitating","Dua Lipa","Pop",203],
  ["M3M1i6ivkug","Sunflower","Post Malone","Pop",158],
  ["E4sryjCt5xI","Waka Waka","Shakira","Pop",215],
  ["weRHyjj34ZE","Whenever Wherever","Shakira","Pop",215],
  ["VBmMU_iwe6U","Run the World","Beyonce","Pop",235],
  ["OMD8hBsA-RI","Faithfully","Journey","Rock",280],
  ["MIwthjJxyTY","Take On Me","a-ha","Pop",225],
  ["Vsum-2Cs2gI","Bohemian Rhapsody","Queen","Rock",355],
  ["cJLH5yXoqi8","The Lady in My Life","Michael Jackson","Pop",275],
  ["X1q_91vudlY","As It Was","Harry Styles","Pop",167],
  ["DDAqLSCvA4A","good 4 u","Olivia Rodrigo","Pop",178],
  ["yWzx3R81KWg","drivers license","Olivia Rodrigo","Pop",242],
  ["C4hwsb1HPaU","deja vu","Olivia Rodrigo","Pop",215],
  ["m8rM7Tox1HE","Grace","Lewis Capaldi","Pop",210],
  ["T1sobCLau58","HOT TO GO!","Chappell Roan","Pop",185],
  ["OeTVyL8swZg","Riptide","Vance Joy","Indie",215],
  ["UaSOd3L61xM","Someone You Loved","Lewis Capaldi","Pop",182],
  ["PwlI2RhTNkU","Good Luck Babe","Chappell Roan","Pop",215],
  ["kMQSbqZZEfA","Blinding Lights","The Weeknd","Pop",200],
  ["xSUoqHrqXFA","Mr Brightside","The Killers","Rock",222],
  ["CuUefy9bT9U","Livin On A Prayer","Bon Jovi","Rock",250],
  ["Rbm6GXllBiw","Paradise City","Guns N Roses","Rock",320],
  ["-mZURD3LAW0","In The End","Linkin Park","Rock",215],
  ["D10PmrZYYvU","Dont Stop Believin","Journey","Rock",250],
  ["_QTdGbuUKRo","Havana","Camila Cabello","Pop",215],
  ["iuWPNun560I","Shallow","Lady Gaga","Pop",216],
  ["TEpTNFHHjNg","Shake It Off","Taylor Swift","Pop",230],
  ["AoAm4om0wTs","Bad Romance","Lady Gaga","Pop",295],
  ["s1A3X_VA-us","Poker Face","Lady Gaga","Pop",240],
  ["-Q0m-48Sjok","Born This Way","Lady Gaga","Pop",260],
  ["1gWN0KMrNLI","Telephone","Lady Gaga","Pop",270],
  ["GmlZOLz8w5A","Just Dance","Lady Gaga","Pop",240],
  ["MXED3PMqcm8","Raabta","Arijit Singh","Indian",265],
  ["5xNQJ1PQptk","Pehli Nazar Mein","Atif Aslam","Indian",260],
  ["oejq5SRgZbA","Kabira","Arijit Singh","Indian",260],
  ["YipYZY3mmO0","Meri Aashiqui","Arijit Singh","Indian",310],
  ["qtFWHhJ1MUM","Tum Hi Ho","Arijit Singh","Indian",262],
  ["a-b7zSIn47M","Kuch Kuch Hota Hai","Udit Narayan","Indian",315],
  ["v9Ll3Gw9Szc","Suraj Hua Maddham","Sonu Nigam","Indian",370],
  ["5Nr4rA0xm88","Kuch Is Tarha","Atif Aslam","Indian",280],
  ["ktPD6TMovxs","Humnava","Papon","Indian",290],
  ["Pk2Px3V-jeY","Phir Le Aaya Dil","Rekha Bhardwaj","Indian",265],
  ["PPkuC_K4B3U","Tu Jaane Na","Atif Aslam","Indian",290],
  ["rTuxUAuJRyY","Tera Hone Laga Hoon","Atif Aslam","Indian",280],
  ["7tH9B9Y_p44","Main Rang Sharbaton Ka","Atif Aslam","Indian",310],
  ["lWDWyJHHxss","Woh Lamhe","Atif Aslam","Indian",290],
  ["sqdg8bCsLy0","Dil To Pagal Hai","Lata Mangeshkar","Indian",295],
  ["NmLnSgz016E","Pehla Nasha","Udit Narayan","Indian",300],
  ["1Nf8eQ9dkGY","Kaho Naa Pyaar Hai","Udit Narayan","Indian",310],
  ["wKcNNVJ-JhY","Ek Pal Ka Jeena","Atif Aslam","Indian",290],
  ["LlfwtvdSVRw","Hona Tha Pyar","Atif Aslam","Indian",280],
  ["ZVycL3h1fFw","Maula Mere Maula","Roop Kumar Rathod","Indian",330],
  ["0p6ORz02Yr0","Tere Liye","Sonu Nigam","Indian",340],
  ["jFmi69lb8sQ","Hona Tha Pyar","Atif Aslam","Indian",280],
  ["1BWdglekty0","Maahi Ve","Udit Narayan","Indian",340],
  ["BtlnpBb4O8E","Tip Tip Barsa Paani","Alka Yagnik","Indian",340],
  ["YXIbZ6dHRqQ","Tujhe Dekha Toh","Lata Mangeshkar","Indian",340],
  ["YKCAvPp3VHY","Chura Liya Hai Tumne","Asha Bhosle","Indian",320],
  ["xbUf8VbH2o8","Hawa Ke Saath","Kishore Kumar","Indian",310],
  ["jKaGdsxODk0","Mere Sapno Ki Rani","Kishore Kumar","Indian",290],
  ["uZwKgMyHGA0","Dil Cheez Kya Hai","Asha Bhosle","Indian",300],
  ["jkPjMlnJcm0","Zara Zara","Bombay Jayashri","Indian",310],
  ["lmzJvGfCQGQ","Aankhein Khuli","Lata Mangeshkar","Indian",360],
  ["MCXQXuKpgKE","Albela Sajan","Udit Narayan","Indian",320],
  ["f2Mrs2krSoQ","Aaja Re O Mere Dilbar","Kishore Kumar","Indian",290],
  ["DULDIS2qlCU","Tumhi Dekho Naa","Sonu Nigam","Indian",300],
  ["cBj3q78RkUo","Roja Janeman","Hariharan","Indian",310],
  ["AsrqYY4mPLo","Yoon Shabnami","Parthiv Gohil","Indian",290],
  ["m8RHRqbNnH4","Shukran Allah","Sonu Nigam","Indian",340],
  ["qi_QjFEAwps","Kun Faya Kun","A.R. Rahman","Indian",350],
  ["ullX33wZvv4","Maa Tujhe Salaam","A.R. Rahman","Indian",310],
  ["SayFA4LmYUQ","Jai Ho","A.R. Rahman","Indian",340],
  ["T73l6PpIlf4","Don Title Track","Shankar Mahadevan","Indian",290],
  ["7HDzOQWlFaw","Kabhi Alvida Naa Kehna","Sonu Nigam","Indian",350],
  ["a020QixlNUo","Koi Mil Gaya","Udit Narayan","Indian",310],
  ["P1VV_O8izwM","Tum Se Hi","Mohit Chauhan","Indian",300],
  ["qo_VbDDf0hg","Agar Tum Saath Ho","Arijit Singh","Indian",332],
  ["ig8wdxVx0o8","Dil Ne Ye Kaha Hai Dil Se","KK","Indian",310],
  ["BE8_rNJOQ-0","Yeh Ladka Hai Allah","Udit Narayan","Indian",340],
  ["7AjMu3IG2Yk","Taste","Sabrina Carpenter","Pop",180],
  ["bmeUGC0iOCg","Manchild","Sabrina Carpenter","Pop",185],
  ["HfWLgELllZs","luther","Kendrick Lamar","Hip Hop",235],
  ["jjJzWikgId4","Anxiety","Doechii","Hip Hop",210],
  ["UEA_Np7fQXc","Messy","Lola Young","Pop",195],
  ["_V17ZR_fzhU","Gnarly","KATSEYE","K-Pop",185],
  ["3af9KM3Eq-E","KLouFRENS","Bad Bunny","Latin",225],
  ["dRDlQ6KigAk","Soltera","Shakira","Latin",205],
  ["dyRsYk0LyA8","Lovesick Girls","BLACKPINK","K-Pop",215],
  ["ggV-ZYkE2oQ","Dirty Work","aespa","K-Pop",195],
  ["iokHCHBerdI","Baile Inolvidable","Bad Bunny","Latin",230],
  ["Rgw9mBeocBI","Killin It Girl","J-Hope","K-Pop",190],
  ["TyGnteqFPcQ","Rebel Heart","IVE","K-Pop",200],
  ["WdSGEvDGZAo","NUEVAYoL","Bad Bunny","Latin",215],
  ["Xv0T-8z-WnE","Lemon Drop","ATEEZ","K-Pop",200],
  ["cii6ruuycQA","deja vu","Olivia Rodrigo","Pop",215],
  ["IzPQ_jA00bk","Chemical","Post Malone","Pop",210],
  ["Y8cnCtzu1Gg","As It Was","Harry Styles","Pop",167],
  ["a2r0JAfBCWc","What I Want","Morgan Wallen","Country",210],
  ["O1iXvRRyaBE","So Cynical","The Sydneys","Pop",195],
  ["FtThjF99hws","Die With A Smile","Lady Gaga","Pop",260],
  ["hl54UMI59w0","HOT TO GO!","Chappell Roan","Pop",185],
  ["srxH_ImMgA4","Earthquake","JISOO","K-Pop",200],
  ["xCybrChj5Hs","Stargazing","Myles Smith","Pop",190],
  ["WcIcVapfqXw","Calm Down","Rema","Afrobeats",240],
  ["VGuB4OeLTE0","Ordinary","Alex Warren","Pop",200],
  ["7jFZ4Bbdv48","Si Antes Te Hubiera Conocido","Karol G","Latin",220],
  ["I-rhMv5iS5Y","Save Your Tears","The Weeknd","Pop",215],
  ["MN4TGm4FB8w","Blinding Lights","The Weeknd","Pop",200],
  ["niewe7xfoWs","Levitating","Dua Lipa","Pop",203],
  ["XmogLuRroBQ","Watermelon Sugar","Harry Styles","Pop",174],
  ["FiXCxfWWwPo","Dance Monkey","Tones and I","Pop",210],
  ["3ApM0HfNtV4","Sunflower","Post Malone","Pop",158],
  ["e33V9wBPYVI","Billie Jean","Michael Jackson","Pop",294],
  ["Ba-3gSzT83w","Bohemian Rhapsody","Queen","Rock",355],
  ["Ep0-h-rGHRk","Bad Romance","Lady Gaga","Pop",295],
  ["S9S4015HvTc","Good Luck Babe","Chappell Roan","Pop",215],
  ["QrlRrF77c5g","End of Beginning","Djo","Indie",225],
  ["IRM4YzfSIYg","Riptide","Vance Joy","Indie",215],
  ["GllEDACUbNo","Just A Lil Bit","50 Cent","Hip Hop",225],
  ["pKCs0gb3OpU","Lose Yourself","Eminem","Hip Hop",320],
  ["py7HfyXMuSg","Smooth","Santana","Rock",295],
  ["Pv3pXjrtkyI","Hey Ya!","OutKast","Hip Hop",235],
  ["tF-fAsSXQIY","Genie In A Bottle","Christina Aguilera","Pop",220],
  ["5a9ozuMcMYY","Baby One More Time","Britney Spears","Pop",215],
  ["D0FPGAptauI","Jumpin Jumpin","Destinys Child","Pop",235],
  ["fBQIMjQd_k8","Bye Bye Bye","NSYNC","Pop",200],
  ["GCyBs6eNxBo","No Scrubs","TLC","R&B",215],
  ["XWJrPzAUzAs","Angel","Shaggy","Pop",250],
  ["YZsyXRlrigs","Hanging By A Moment","Lifehouse","Rock",240],
  ["iBBqjGd3fHQ","My Own Prison","Creed","Rock",290],
  ["3Kg4geYCEjo","Yellow","Coldplay","Rock",265],
  ["Q1XpPOQBtWo","Numb","Linkin Park","Rock",195],
  ["rYEDA3JcQqw","Rolling in the Deep","Adele","Pop",235],
  ["A8KJlAiFW9Y","Someone Like You","Adele","Pop",285],
  ["nSDgHBxUbVQ","Photograph","Ed Sheeran","Pop",255],
  ["stwafMkBEEk","Thinking Out Loud","Ed Sheeran","Pop",280],
  ["RvYcatJB3NU","Uptown Funk","Bruno Mars","Pop",270],
  ["fRh_vgS2dFE","Sorry","Justin Bieber","Pop",200],
  ["bKBrlryde4A","Peaches","Justin Bieber","Pop",198],
  ["mY00uFz5bTA","Love Yourself","Justin Bieber","Pop",235],
  ["rmvuZu4KB7c","Dark Horse","Katy Perry","Pop",215],
  ["2TlF9d7_K_o","Closer","Chainsmokers","Pop",245],
  ["qV5lzRHrGeg","I Really Like You","Carly Rae Jepsen","Pop",205],
  ["4UE6YHJc5Go","Party Rock Anthem","LMFAO","Electronic",245],
  ["tTQApK_o5uI","See You Again","Wiz Khalifa","Hip Hop",237],
  ["fQQsvUGXEY4","My Universe","Coldplay","Pop",230],
  ["bXcSLI58-h8","Panini","Lil Nas X","Hip Hop",195],
  ["l5vwUFlowkU","Say So","Doja Cat","Pop",195],
  ["1oMgxa32A7g","Kiss Me More","Doja Cat","Pop",198],
  ["msGuqelopMA","Watermelon Sugar","Harry Styles","Pop",174],
  ["2Tr81LPq6Fw","Kings & Queens","Ava Max","Pop",185],
  ["JCfMkY-PbDs","drivers license","Olivia Rodrigo","Pop",242],
  ["WRt7DZ-bk6M","Levitating","Dua Lipa","Pop",203],
  ["IkeZX2hnoOk","Butter","BTS","K-Pop",195],
  ["E5zDVXshx2Y","Blinding Lights","The Weeknd","Pop",200],
  ["rkXKEc3XRZU","Oops I Did It Again","Britney Spears","Pop",225],
  ["WrpBgN_iUnA","Caution","The Killers","Rock",225],
  ["PbW14E2eHJ0","Get Low","Zedd","Electronic",225],
  ["m3FgX1Y83t0","Sorry","Justin Bieber","Pop",200],
  ["Zi_XLOBDo_Y","Billie Jean","Michael Jackson","Pop",294],
  ["4V90AmXnguw","Thriller","Michael Jackson","Pop",357],
  ["8fO8jVZ3T9g","Beat It","Michael Jackson","Pop",258],
  ["h_D3VFfhvs4","Smooth Criminal","Michael Jackson","Pop",251],
  ["09839DpTctU","Hotel California","Eagles","Rock",391],
  ["-tJYN-eG1zk","We Will Rock You","Queen","Rock",202],
  ["6M6samPEMpM","Everybody","Backstreet Boys","Pop",223],
  ["4fndeDfaWCg","I Want It That Way","Backstreet Boys","Pop",213],
  ["Bsy8Pd_FHDk","Chaleya","Arijit Singh","Indian",212],
  ["inEu2qQuGZ8","Sun Raha Hai Na Tu","Shreya Ghoshal","Indian",267],
  ["B8MSjHTo154","Chori Chori Dil Tera","Kumar Sanu","Indian",240],
  ["sYr6bQMo4_o","Dil Tera Aashiq","Kumar Sanu","Indian",255],
  ["tD8M2BpSnwc","Dekhne Walon Ne","Udit Narayan","Indian",230],
  ["TwFBtV13KQQ","One Bottle Down","Yo Yo Honey Singh","Hip Hop",220],
  ["NbyHNASFi6U","Blue Eyes","Yo Yo Honey Singh","Hip Hop",215],
  ["TvngY4unjn4","Love Dose","Yo Yo Honey Singh","Hip Hop",225],
  ["NrXdauEv9HY","Dope Shope","Yo Yo Honey Singh","Hip Hop",198],
  ["1bvYHkQxWmg","Makhna","Yo Yo Honey Singh","Hip Hop",210],
  ["oRdxUFDoQe0","Smooth Criminal","Michael Jackson","Pop",251],
];

const seen2 = new Set();
let songs = SONGS.filter(s => { if (seen2.has(s[0])) return false; seen2.add(s[0]); return true; })
  .map((s, i) => ({ id: "yt-" + i, youtubeId: s[0], title: s[1], artist: s[2], genre: s[3], duration: s[4], coverArt: "https://img.youtube.com/vi/" + s[0] + "/mqdefault.jpg" }));

app.get("/api/songs", (_req, res) => res.json({ songs, total: songs.length }));
app.get("/api/search", (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  if (!q) return res.json({ songs });
  res.json({ songs: songs.filter(s => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q)) });
});
app.get("/api/genre/:genre", (req, res) => {
  res.json({ songs: songs.filter(s => s.genre.toLowerCase() === req.params.genre.toLowerCase()) });
});

// YouTube Search endpoint
const SKIP_WORDS = ['lyrics video', 'karaoke', 'instrumental', 'cover by', 'live performance', 'reaction', 'interview', 'behind the scenes', 'making of', 'tutorial', 'how to', 'unboxing', 'vlog', 'compilation', 'top 10', 'best of', 'album mix', 'jukebox', 'full album', 'slowed + reverb', 'sped up', 'nightcore', 'mashup', 'remix by'];

function isMusicResult(r) {
  const lower = (r.title + ' ' + r.artist).toLowerCase();
  if (r.duration > 0 && (r.duration < 30 || r.duration > 900)) return false;
  for (const w of SKIP_WORDS) { if (lower.includes(w)) return false; }
  return true;
}

app.get("/api/youtube/search", (req, res) => {
  const q = req.query.q || "";
  if (!q) return res.json({ results: [] });

  const args = [
    "ytsearch10:" + q,
    "--flat-playlist",
    "--dump-json",
    "--no-warnings",
    "--no-check-certificates"
  ];

  execFile("yt-dlp", args, { timeout: 15000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      console.error("[YT Search] Error:", err.message);
      return res.json({ results: [] });
    }
    try {
      const lines = stdout.trim().split("\n").filter(Boolean);
      const results = lines.map(line => {
        const data = JSON.parse(line);
        return {
          id: data.id || data.url,
          title: data.title || "Unknown",
          artist: data.channel || data.uploader || "Unknown",
          duration: data.duration || 0,
          thumbnail: data.thumbnails?.[data.thumbnails.length - 1]?.url || "https://img.youtube.com/vi/" + (data.id || "") + "/mqdefault.jpg",
          viewCount: data.view_count || 0
        };
      }).filter(r => r.id && isMusicResult(r));
      res.json({ results });
    } catch (e) {
      console.error("[YT Search] Parse error:", e.message);
      res.json({ results: [] });
    }
  });
});

// YouTube Trending endpoint - fetches trending music
let trendingCache = null;
let trendingCacheTime = 0;

app.get("/api/youtube/trending", (req, res) => {
  const now = Date.now();
  // Cache for 10 minutes
  if (trendingCache && (now - trendingCacheTime) < 600000) {
    return res.json({ results: trendingCache });
  }

  const queries = [
    "trending songs 2025",
    "top hits right now",
    "most popular songs today",
    "viral music 2025",
    "billboard hot 100"
  ];

  const allResults = [];
  let done = 0;

  for (const q of queries) {
    execFile("yt-dlp", [
      "ytsearch5:" + q,
      "--flat-playlist",
      "--dump-json",
      "--no-warnings",
      "--no-check-certificates"
    ], { timeout: 12000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (!err && stdout) {
        try {
          const lines = stdout.trim().split("\n").filter(Boolean);
          for (const line of lines) {
            const data = JSON.parse(line);
            if (data.id && !allResults.find(r => r.id === data.id)) {
              const entry = {
                id: data.id,
                title: data.title || "Unknown",
                artist: data.channel || data.uploader || "Unknown",
                duration: data.duration || 0,
                thumbnail: data.thumbnails?.[data.thumbnails.length - 1]?.url || "https://img.youtube.com/vi/" + data.id + "/mqdefault.jpg",
                viewCount: data.view_count || 0
              };
              if (isMusicResult(entry)) allResults.push(entry);
            }
          }
        } catch (e) {}
      }
      done++;
      if (done === queries.length) {
        trendingCache = allResults.slice(0, 30);
        trendingCacheTime = Date.now();
        res.json({ results: trendingCache });
      }
    });
  }
});

app.get("/api/health", (req, res) => {
  execFile("yt-dlp", ["--version"], (err, stdout) => {
    res.json({ status: "ok", ytDlpVersion: stdout.trim(), node: process.version });
  });
});

// Audio streaming endpoint - streams audio from YouTube
app.get("/api/stream/:videoId", (req, res) => {
  const videoId = req.params.videoId;
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: "Invalid video ID" });
  }

  const audioUrl = "https://www.youtube.com/watch?v=" + videoId;

  const yt = spawn("yt-dlp", [
    "-f", "bestaudio/best",
    "-o", "-",
    "--no-warnings",
    "--no-check-certificates",
    "--extractor-args", "youtube:player_client=mediaconnect",
    audioUrl
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let headersSent = false;
  let startupTimeout = setTimeout(() => {
    if (!headersSent) {
      yt.kill("SIGTERM");
      if (!res.headersSent) {
        res.status(504).json({ error: "Stream timed out" });
      }
    }
  }, 30000);

  let firstChunk = true;
  yt.stdout.on("data", (chunk) => {
    if (firstChunk) {
      firstChunk = false;
      headersSent = true;
      clearTimeout(startupTimeout);
      res.setHeader("Content-Type", "audio/webm");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Content-Type-Options", "nosniff");
    }
    res.write(chunk);
  });

  yt.stderr.on("data", (data) => {
    console.error("[Stream]", data.toString().trim());
  });

  yt.on("error", (err) => {
    clearTimeout(startupTimeout);
    console.error("[Stream] Process error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Stream error" });
  });

  yt.on("close", (code) => {
    clearTimeout(startupTimeout);
    if (code && code !== 0 && !headersSent) {
      console.error("[Stream] yt-dlp exited with code:", code);
      if (!res.headersSent) res.status(500).json({ error: "Stream failed" });
    }
  });

  req.on("close", () => {
    clearTimeout(startupTimeout);
    yt.kill("SIGTERM");
  });
});

// Download endpoint - returns audio file for download
app.get("/api/download/:videoId", (req, res) => {
  const videoId = req.params.videoId;
  const title = req.query.title || "song";
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: "Invalid video ID" });
  }

  const safeName = title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_").substring(0, 80);
  const audioUrl = "https://www.youtube.com/watch?v=" + videoId;

  res.setHeader("Content-Disposition", 'attachment; filename="' + safeName + '.mp3"');
  res.setHeader("Content-Type", "audio/mpeg");

  const yt = spawn("yt-dlp", [
    "-f", "bestaudio[ext=m4a]/bestaudio",
    "--extract-audio",
    "--audio-format", "mp3",
    "--audio-quality", "0",
    "-o", "-",
    "--no-warnings",
    "--no-check-certificates",
    "--extractor-args", "youtube:player_client=mediaconnect",
    audioUrl
  ], { stdio: ["ignore", "pipe", "pipe"] });

  yt.stdout.pipe(res);

  yt.stderr.on("data", (data) => {
    console.error("[Download]", data.toString().trim());
  });

  yt.on("error", (err) => {
    console.error("[Download] Process error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Download error" });
  });

  req.on("close", () => {
    yt.kill("SIGTERM");
  });
});

// Get audio info (for preloading stream URL)
app.get("/api/audio-info/:videoId", (req, res) => {
  const videoId = req.params.videoId;
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: "Invalid video ID" });
  }

  execFile("yt-dlp", [
    "-f", "bestaudio[ext=m4a]/bestaudio",
    "--dump-json",
    "--no-warnings",
    "--no-check-certificates",
    "https://www.youtube.com/watch?v=" + videoId
  ], { timeout: 10000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: "Failed to get info" });
    try {
      const info = JSON.parse(stdout);
      res.json({
        title: info.title,
        artist: info.uploader || info.channel,
        duration: info.duration,
        thumbnail: info.thumbnail,
        formats: (info.formats || []).filter(f => f.acodec !== "none").map(f => ({
          url: f.url,
          quality: f.format_note,
          ext: f.ext,
          bitrate: f.abr
        }))
      });
    } catch (e) {
      res.status(500).json({ error: "Parse error" });
    }
  });
});

// Serve static frontend in production
const distPath = path.join(__dirname, "dist");
const fs = require("fs");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  // Serve APK with download headers
  app.get("/download", (req, res) => {
    const apkPath = path.join(distPath, "MusicApp.apk");
    if (fs.existsSync(apkPath)) {
      res.setHeader("Content-Type", "application/vnd.android.package-archive");
      res.setHeader("Content-Disposition", 'attachment; filename="MusicApp.apk"');
      res.sendFile(apkPath);
    } else {
      res.status(404).json({ error: "APK not found" });
    }
  });
  app.get("/{*splat}", (req, res) => {
    if (!req.path.startsWith("/api/")) {
      res.sendFile(path.join(distPath, "index.html"));
    }
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server: " + songs.length + " songs on http://localhost:" + PORT);
  autoScrapeTrending().catch((err) => {
    console.error("[Auto-Scrape] Fatal error:", err.message || err);
  });
});

async function autoScrapeTrending() {
try {
  const https = require("https");
  const http = require("http");
  const QUERIES = [
    "trending songs 2025", "top hits 2025", "viral songs 2025",
    "trending Bollywood 2025", "trending K-pop 2025", "trending Latin 2025",
    "new music 2025", "most popular songs now", "trending TikTok music 2025",
    "new pop songs 2025", "latest Hindi hits", "Arijit Singh new 2025",
    "Taylor Swift new 2025", "Bad Bunny new 2025", "BLACKPINK new 2025",
    "Ed Sheeran new 2025", "Diljit Dosanjh new 2025", "Sabrina Carpenter trending",
    "Dua Lipa trending", "Post Malone trending", "Kendrick Lamar trending",
    "Billie Eilish trending", "Olivia Rodrigo trending", "Lady Gaga trending",
  ];
  function fetchPage(url) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith("https") ? https : http;
      const req = mod.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" }, timeout: 8000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return fetchPage(res.headers.location).then(resolve).catch(reject);
        let data = ""; res.on("data", chunk => data += chunk); res.on("end", () => resolve(data));
      });
      req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    });
  }
  function extractIds(html) { const ids = []; const re = /"videoId":"([A-Za-z0-9_-]{11})"/g; let m; while ((m = re.exec(html)) !== null) ids.push(m[1]); return [...new Set(ids)]; }
  async function getTitle(id) { try { const html = await fetchPage("https://www.youtube.com/watch?v=" + id); const m = html.match(/<title>(.*?)<\/title>/); if (m) return m[1].replace(/ - YouTube$/, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\|/g, "-").trim(); } catch {} return null; }
  function parseTitle(t) { if (!t) return null; let c = t.replace(/\(Official( Music)? Video\)/gi, "").replace(/\[Official( Music)? Video\]/gi, "").replace(/\(Lyrics\)/gi, "").replace(/\[Lyrics\]/gi, "").replace(/\(Audio\)/gi, "").replace(/\(Official Audio\)/gi, "").replace(/\(VEVO\)/gi, "").replace(/\(4K\)/gi, "").replace(/\(HD\)/gi, "").trim(); const p = c.split(" - "); if (p.length >= 2) return { artist: p[0].trim(), title: p.slice(1).join(" - ").trim() }; return { artist: "Unknown", title: c }; }
  function guessGenre(t, a) { const x = (t + " " + a).toLowerCase(); if (/arijit|shreya|atif|udit|sonu nigam|kishore|lata|rahat|kumar sanu|alka|KK|shaan|sunidhi|sukhwinder|sachin|vishal|pritam|ankit|mithoon|tanishk|bpraak|guru randhawa|diljit|badshah|ap dhillon|karan aujla|raabta|tum hi ho|kabira|kuch kuch|suraj hua|pehla nasha|zara zara|aankhein|tip tip|maula|chura liya|mere sapno|dil cheez|roja|shukran|tere liye|albela|koi mil|tumhi dekho|maahi ve|dekha toh/.test(x)) return "Indian"; if (/kpop|bts|blackpink|aespa|twice|ive|newjeans|stray kids|ateez|lesserafim|seventeen|jennie|lisa|rosé|jimin|jungkook|j-hope|jin /.test(x)) return "K-Pop"; if (/bad bunny|j balvin|karol g|shakira|maluma|rauw|daddy yankee|feid|ozuna|becky g|fuerza|natanael|peso pluma/.test(x)) return "Latin"; if (/burna boy|wizkid|davido|rema|fireboy|ayra|tems|asake|omah|ckay|black sherif|shenseea/.test(x)) return "Afrobeats"; if (/rap|hip hop|drake|kendrick|travis scott|post malone|cardi b|meg|future|21 savage|lil|gunna|kanye|eminem|nicki|jack harlow|baby keem|sZA|summer walker|brent faiyaz|6lack|snoh/.test(x)) return "Hip Hop"; if (/rock|metal|linkin|imagine dragons|maroon 5|coldplay|queen|bon jovi|killers|foo fighters|ac dc|led zeppelin|beatles|pink floyd/.test(x)) return "Rock"; if (/electro|edm|alan walker|marshmello|calvin harris|david guetta|martin garrix|tiesto|skrillex|zedd|kygo/.test(x)) return "Electronic"; if (/indie|hozier|lana del|glass animals|clairo|beabadoobee|laufey|still woozy|benson boone|gigi perez|sam fender/.test(x)) return "Indie"; if (/r&b|soul|the weeknd|sza|frank ocean|anderson .paak|silk sonic|bruno mars|teddy swims|leon thomas/.test(x)) return "R&B"; if (/country|morgan wallen|luke combs|blake shelton|carrie|kacey|chris stapleton|jelly roll|zach bryan|noah kahan/.test(x)) return "Country"; return "Pop"; }
  let addedCount = 0;
  const existingIds = new Set(songs.map(s => s.youtubeId));
  for (let i = 0; i < QUERIES.length; i++) {
    try {
      const html = await fetchPage("https://www.youtube.com/results?search_query=" + encodeURIComponent(QUERIES[i]));
      const ids = extractIds(html);
      for (const id of ids.slice(0, 5)) {
        if (existingIds.has(id)) continue;
        const title = await getTitle(id); if (!title) continue;
        const parsed = parseTitle(title); if (!parsed || parsed.title.length < 2 || parsed.artist === "Unknown") continue;
        const genre = guessGenre(parsed.title, parsed.artist);
        existingIds.add(id);
        songs.push({ id: "yt-" + songs.length, youtubeId: id, title: parsed.title, artist: parsed.artist, genre, duration: 180 + Math.floor(Math.random() * 120), coverArt: "https://img.youtube.com/vi/" + id + "/mqdefault.jpg" });
        addedCount++;
      }
      if (i % 10 === 0) console.log("[Auto-Scrape] " + (i + 1) + "/" + QUERIES.length + " queries, added " + addedCount + " new songs");
      await new Promise(r => setTimeout(r, 300));
    } catch {}
  }
  if (addedCount > 0) console.log("[Auto-Scrape] Done! Added " + addedCount + " trending songs. Total: " + songs.length);
} catch (err) {
  console.error("[Auto-Scrape] Error:", err.message || err);
}
}
