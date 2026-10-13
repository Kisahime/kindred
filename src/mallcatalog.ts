// Built-in Shopping Centre catalogue (offline). Line format: "emoji|name|description|tier 1-4|tags|w" (w = wearable).
export const DEPARTMENTS = [
  { id: "clothing", label: "Clothing & Accessories", emoji: "\u{1F457}" },
  { id: "tech", label: "Tech & Gadgets", emoji: "\u{1F4F1}" },
  { id: "home", label: "Home & Decor", emoji: "\u{1F6CB}\uFE0F" },
  { id: "books", label: "Books & Stationery", emoji: "\u{1F4DA}" },
  { id: "beauty", label: "Beauty & Self-care", emoji: "\u{1F9F4}" },
  { id: "food", label: "Food & Treats", emoji: "\u{1F36B}" },
  { id: "flowers", label: "Flowers & Plants", emoji: "\u{1F490}" },
  { id: "toys", label: "Toys & Games", emoji: "\u{1F3B2}" },
  { id: "hobbies", label: "Hobbies & Crafts", emoji: "\u{1F3A8}" },
  { id: "jewellery", label: "Jewellery", emoji: "\u{1F48D}" },
  { id: "seasonal", label: "Seasonal", emoji: "\u{1F383}" },
] as const;
export type DeptId = typeof DEPARTMENTS[number]["id"];

export const CATALOG_RAW: Record<DeptId, string> = {
  clothing: `
🧣|Chunky knit scarf|Oversized, soft and warm|2|cosy|w
🧤|Fingerless gloves|Keeps hands warm while texting|1|cosy,practical|w
🧥|Wool winter coat|Long, tailored and snug|4|cosy,glam|w
🧥|Denim jacket|A classic that goes with everything|3|sporty,practical|w
👕|Band T-shirt|Vintage-style tour tee|2|music|w
👕|Pixel art T-shirt|Retro game sprite print|2|nerdy,gamer|w
👚|Silk blouse|Light and elegant|3|glam,romantic|w
👗|Sundress|Floaty, floral and summery|3|cute,romantic|w
👗|Little black dress|Timeless evening classic|4|glam,romantic|w
👖|Comfy joggers|Lounge-all-day soft|2|cosy,sporty|w
🩳|Running shorts|Light and breathable|1|sporty|w
🧦|Fluffy bed socks|Cloud-soft, for cold toes|1|cosy,cute|w
🧦|Novelty socks|Little cats with toast|1|cute,family|w
🧢|Baseball cap|Embroidered logo cap|1|sporty|w
👒|Straw sun hat|Wide brim for sunny days|2|outdoorsy,cute|w
🎩|Vintage fedora|Felt hat with a ribbon band|2|glam,music|w
🥾|Hiking boots|Waterproof and sturdy|3|outdoorsy,sporty|w
👟|Trainers|Bouncy everyday sneakers|3|sporty|w
👠|Heeled boots|Sleek ankle boots|3|glam|w
🥿|Ballet flats|Comfy and cute|2|cute|w
🧶|Cable-knit jumper|Thick wool, cosy fit|3|cosy|w
🧥|Cosy hoodie|Big pocket, fleece lining|2|cosy,gamer|w
👘|Silky dressing gown|For slow mornings|3|cosy,luxury|w
🩱|Swimsuit|For the beach or the pool|2|sporty,outdoorsy|w
🕶️|Retro sunglasses|Round tinted lenses|2|glam,music|w
👜|Leather handbag|Roomy and structured|4|glam,luxury|w
🎒|Canvas backpack|Lots of pockets|2|practical,outdoorsy|w
🧣|Matching couple scarves|Two scarves, one for each of you|2|romantic,cosy|w
⌚|Sports watch|Tracks steps and heart rate|3|sporty,nerdy|w
🎀|Satin hair ribbon|A soft bow for any outfit|1|cute|w`,
  tech: `
🎧|Wireless headphones|Noise-cancelling, deep bass|4|music,nerdy,gamer
🎧|Cute cat-ear headphones|Light-up ears|2|cute,gamer
⌨️|Mechanical keyboard|Clicky switches, RGB glow|3|nerdy,gamer
🖱️|Gaming mouse|Fast, light, glowy|2|gamer
🎮|Handheld console|Games on the go|4|gamer,nerdy
🕹️|Retro mini arcade|Fifty classic games|3|gamer,family
📱|Phone case|Pastel clouds design|1|cute,practical
🔋|Power bank|Never run out of battery|2|practical
📷|Instant camera|Prints photos on the spot|3|artsy,cute
📸|Mirrorless camera|For serious photographers|4|artsy,outdoorsy
🔊|Bluetooth speaker|Pocket-sized, big sound|2|music,outdoorsy
📻|Retro radio|Wooden case, warm sound|2|music,cosy
💡|Smart bulb|Changes colour with your mood|1|nerdy,cosy
🌙|Sunrise alarm clock|Wakes you with light|2|cosy,practical
⌚|Smartwatch|Messages on your wrist|4|nerdy,sporty|w
🖊️|Digital drawing tablet|Draw straight onto the screen|4|artsy,nerdy
🔭|Starter telescope|See the moons of Jupiter|3|nerdy,outdoorsy
🤖|Build-your-own robot|Programmable kit|3|nerdy,family
🎤|Karaoke microphone|Bluetooth, with echo|2|music,family
🧊|Mini fridge|Drinks within arm's reach|3|gamer,practical
💾|Retro floppy coasters|Set of six|1|nerdy
🛸|Galaxy projector|Stars across your ceiling|2|cosy,nerdy,romantic
🔌|Cable organiser|Tidy desk, tidy mind|1|practical
📖|E-reader|A thousand books in your bag|3|bookish
🎚️|Mini synthesiser|Pocket music maker|3|music,nerdy`,
  home: `
🕯️|Scented candle|Vanilla and amber|1|cosy,romantic
🕯️|Candle trio|Pine, cinnamon and fig|2|cosy
🛋️|Velvet cushion|Soft and plump|1|cosy,glam
🧸|Weighted blanket|Like a long hug|3|cosy
🛏️|Linen bedding set|Breathable and soft|3|cosy,luxury
🪞|Arched mirror|Gold-framed|3|glam
🖼️|Art print|Watercolour landscape|2|artsy
🪴|Macramé plant hanger|Boho knots|1|artsy,nature
☕|Hand-thrown mug|Speckled glaze|1|cosy,foodie
🫖|Teapot set|Teapot and two cups|2|cosy,family
🍳|Cast iron pan|Lasts a lifetime|2|foodie,practical
🔪|Chef's knife|Japanese steel|3|foodie
🧺|Picnic basket|Plates and cutlery inside|3|outdoorsy,romantic,family
🌈|Fairy lights|Warm white, 10 metres|1|cosy,cute
🪔|Salt lamp|Pink glow|1|cosy
🕰️|Mantel clock|Brass and walnut|3|luxury
🪑|Reading armchair|Deep and squishy|4|cosy,bookish
🧶|Chunky knit throw|Merino loops|3|cosy
🎐|Wind chime|Bamboo tones|1|nature
🐾|Pet bed|For a furry friend|2|cute,family
🪵|Wooden chopping board|Olive wood|1|foodie
🍷|Wine glasses|Set of two|2|romantic,glam
🧴|Reed diffuser|Fig and cedar|1|cosy
🗺️|Vintage world map|Framed poster|2|outdoorsy,nerdy
🪟|Stained glass suncatcher|Rainbows on the wall|1|artsy,cute`,
  books: `
📕|Cosy mystery novel|A village, a cat, a case|1|bookish,cosy
📗|Fantasy epic|Dragons and a lost crown|2|bookish,nerdy
📘|Sci-fi classic|Space, time and robots|1|bookish,nerdy
📙|Romance paperback|Slow-burn love story|1|bookish,romantic
📓|Leather journal|Thick cream pages|2|bookish,artsy
📔|Dotted notebook|For lists and doodles|1|practical,artsy
🖋️|Fountain pen|Smooth gold nib|3|bookish,luxury
✏️|Coloured pencils|72 shades|2|artsy,family
🖍️|Washi tape set|Twelve pretty rolls|1|cute,artsy
📚|Poetry collection|Short, sweet, tender|1|bookish,romantic
🍳|Cookbook|One-pan comfort food|2|foodie
🌍|Travel guide|Hidden gems of Europe|1|outdoorsy
🧠|Puzzle book|Logic grids and riddles|1|nerdy,family
🎨|Art history book|Glossy and huge|3|artsy
🔖|Brass bookmark|Engraved leaf|1|bookish
✉️|Letter-writing set|Paper, envelopes, wax seal|2|romantic,artsy
🗓️|Illustrated planner|A year of little drawings|2|practical,cute
📖|Graphic novel|Beautiful ink art|2|nerdy,artsy
🧸|Picture book|Lovely to read together|1|family,cute
🌿|Field guide|Birds and wildflowers|1|nature,outdoorsy
🎼|Sheet music book|Favourite piano pieces|1|music
🧙|Tabletop RPG rulebook|Build a hero|3|nerdy,gamer
📜|Calligraphy kit|Nibs, ink and guides|2|artsy
💌|Love letters anthology|Famous letters through history|2|romantic,bookish
🔍|Detective notebook|With a tiny magnifier|1|nerdy,cute`,
  beauty: `
🛁|Bath bomb set|Six fizzy scents|1|cosy,cute
🧴|Hand cream trio|Rose, lavender, citrus|1|practical,cosy
💆|Silk sleep mask|Smooth and dark|2|cosy,luxury
🧖|Spa robe|Waffle cotton|3|cosy,luxury|w
💅|Nail polish set|Pastel collection|1|glam,cute
💄|Lipstick|Classic red|2|glam,romantic
🌸|Perfume|Floral and warm|4|glam,romantic,luxury
🌲|Cologne|Cedar and smoke|4|glam,luxury
🪮|Wooden hairbrush|Gentle bristles|1|practical
🧼|Handmade soap|Oat and honey|1|cosy,nature
🧘|Yoga mat|Grippy and cushioned|2|sporty
💧|Face mask set|Hydrating sheets|1|cute,cosy
🌿|Essential oils|Lavender, eucalyptus, mint|2|nature,cosy
🛀|Bubble bath|Big bubbles, rose scent|1|cosy,romantic
🪥|Electric toothbrush|Sparkly clean|2|practical
🫧|Body scrub|Brown sugar and coconut|1|cosy
🌙|Pillow mist|Sleepy lavender|1|cosy
🧽|Bamboo bath tray|Book holder included|2|cosy,bookish
💤|Satin pillowcase|Kind to hair|2|luxury
☀️|Sun cream|SPF 50 for adventures|1|outdoorsy,practical
💪|Massage gun|For tired muscles|3|sporty
🧖|Self-care box|Treats for a quiet night|3|cosy,cute
🎀|Hair clip set|Pearls and bows|1|cute|w
🪞|Compact mirror|Engraved rose|1|glam,cute
🫶|Spa day voucher|A whole day of pampering|4|luxury,cosy`,
  food: `
🍫|Box of chocolates|Truffles and pralines|2|foodie,romantic
🍪|Cookie tin|Butter cookies|1|foodie,family,cosy
🧁|Cupcake box|Six frosted cupcakes|1|foodie,cute
🍰|Celebration cake|Sponge with berries|2|foodie,family
🍩|Doughnut dozen|Glazed and sprinkled|1|foodie,cute
☕|Speciality coffee beans|Single origin|1|foodie
🍵|Loose-leaf tea sampler|Twelve teas|2|cosy,foodie
🧀|Cheese board|Five cheeses and chutney|2|foodie
🍷|Bottle of red|Smooth and fruity|2|foodie,romantic
🥂|Champagne|For something special|3|glam,romantic,luxury
🍯|Local honey|Wildflower|1|nature,foodie
🍓|Strawberries & cream|Fresh punnet|1|romantic,foodie
🍬|Pick 'n' mix|A big bag of sweets|1|cute,family
🍣|Sushi platter|Twenty pieces|3|foodie
🍕|Pizza night kit|Dough, sauce, toppings|1|foodie,family
🌶️|Hot sauce trio|Mild to fiery|1|foodie
🥐|Pastry basket|Croissants and pain au chocolat|1|foodie,cosy
🍿|Movie snack box|Popcorn and sweets|1|cosy,family
🫕|Fondue set|Melted cheese night|2|foodie,romantic
🍝|Fresh pasta kit|Make your own|1|foodie
🧃|Juice cleanse|Five fresh juices|2|sporty
🍎|Fruit hamper|Seasonal fruit|2|family,nature
🍭|Giant lollipop|Rainbow swirl|1|cute
🥮|Fancy biscuits|Shortbread in a tartan tin|1|cosy,family
🍱|Bento box lunch|Neatly packed|1|foodie,cute`,
  flowers: `
🌹|Dozen red roses|The classic romantic bouquet|2|romantic
💐|Mixed bouquet|Seasonal and bright|2|nature,family
🌷|Tulip bunch|Pastel tulips|1|cute,nature
🌻|Sunflowers|A burst of sunshine|1|nature,family
🌸|Cherry blossom branch|Delicate pink|2|nature,artsy
🪷|Lotus in a bowl|Calm and pretty|2|nature
🌵|Mini cactus trio|Hard to kill|1|cute,practical
🪴|Monstera|Big glossy leaves|2|nature,cosy
🌿|Herb garden kit|Basil, mint, thyme|1|foodie,nature
🍀|Lucky clover pot|Four leaves, maybe|1|cute
🌼|Daisy chain kit|Make a flower crown|1|cute,family
🌺|Orchid|Elegant white blooms|2|glam,nature
🌲|Bonsai tree|Tiny, ancient-looking|3|nature,artsy
🍄|Terrarium|A tiny forest in glass|2|nature,nerdy
🌾|Dried flower wreath|Lasts for years|2|cosy,artsy
💮|Peony bouquet|Fluffy and fragrant|3|romantic,glam
🥀|Preserved rose in a dome|A forever rose|3|romantic,luxury
🌱|Seed collection|Wildflowers for bees|1|nature,outdoorsy
🪻|Lavender bundle|Dried and fragrant|1|cosy,nature
🌳|Fruit tree sapling|Grows lemons, eventually|2|nature,family
💐|Thank-you posy|Small and sweet|1|family,cute
🌷|Flower subscription|A bouquet every week for a month|4|nature,luxury
🪹|Bird feeder|Brings garden visitors|1|nature,outdoorsy
🎍|Lucky bamboo|Good fortune in a vase|1|nature
🌹|Single rose|One perfect stem|1|romantic`,
  toys: `
🧸|Giant teddy bear|Huggable, one metre tall|3|cute,cosy
🐱|Cat plushie|Squishy and round|1|cute
🦖|Dinosaur plush|Rawr|1|cute,family
🧩|1000-piece jigsaw|Cosy café scene|1|cosy,family
🎲|Board game|Build roads, trade sheep|2|family,nerdy
♟️|Wooden chess set|Hand-carved pieces|2|nerdy
🃏|Card game|Fast and silly|1|family,gamer
🪀|Yo-yo|Glow-in-the-dark|1|family
🪁|Kite|Rainbow tail|1|outdoorsy,family
🎯|Dartboard|Pub classic|2|sporty
🏓|Ping-pong set|Paddles and balls|1|sporty,family
🛹|Skateboard|Street deck|2|sporty
⚽|Football|Match ball|1|sporty,family
🧱|Building brick set|A cosy cottage|3|nerdy,family
🚂|Model train|Steam engine set|3|nerdy,family
🎮|Co-op video game|Play together|2|gamer,family
👾|Retro game cartridge|A rare classic|2|gamer,nerdy
🔮|Magic 8-ball|Ask it anything|1|cute,spooky
🪄|Magic trick set|Amaze your friends|1|family
🎈|Balloon bundle|Party in a bag|1|family,cute
🫧|Bubble wand|Giant bubbles|1|family,cute
🦄|Unicorn plush|Sparkly mane|1|cute
🛝|Swing seat|For a tree in the garden|2|outdoorsy,family
🎳|Mini bowling set|Desk-sized|1|family
🧠|Escape room box|Solve it in an hour|2|nerdy,family`,
  hobbies: `
🎨|Watercolour set|24 pans and brushes|2|artsy
🖌️|Acrylic paint kit|Canvas included|2|artsy
🧶|Knitting starter kit|Needles and wool|1|cosy,artsy
🪡|Embroidery hoop kit|Floral pattern|1|artsy,cosy
🧵|Sewing machine|Beginner friendly|4|artsy,practical
🏺|Pottery class|One evening session|3|artsy
📸|Photography course|Four weeks online|3|artsy,nerdy
🎸|Acoustic guitar|Warm tone|4|music
🎹|Keyboard|61 keys|3|music
🥁|Bongo drums|Fun rhythms|2|music,family
🎻|Ukulele|Easy to learn|2|music,cute
🎣|Fishing rod|Starter set|2|outdoorsy
🏕️|Camping tent|Sleeps two|3|outdoorsy
🚴|Bike bell & lights|Ride safe|1|sporty,practical
🧗|Climbing day pass|Bouldering for two|2|sporty
🍞|Bread-making kit|Sourdough starter|1|foodie
🍺|Home brewing kit|Make your own ale|2|foodie
🕯️|Candle-making kit|Wax, wicks, scents|1|artsy,cosy
💎|Bead jewellery kit|Make bracelets|1|artsy,cute
🪵|Whittling kit|Carve a little bird|1|outdoorsy,artsy
🌌|Star map print|Night sky of any date|2|romantic,nerdy
🧩|Model ship kit|Tiny rigging|2|nerdy
🎭|Theatre tickets|Two seats, West End|3|artsy,romantic
🎟️|Concert tickets|Two standing tickets|3|music,romantic
🍷|Wine tasting class|For two|3|foodie,romantic`,
  jewellery: `
💍|Silver ring|Simple band|2|glam|w
💍|Promise ring|Delicate and meaningful|3|romantic|w
📿|Beaded bracelet|Colourful and fun|1|cute|w
📿|Friendship bracelet|Woven, matching pair|1|cute,family|w
💎|Diamond pendant|Tiny sparkle|4|luxury,romantic,glam|w
🔮|Moonstone necklace|Soft milky glow|2|spooky,artsy|w
❤️|Heart locket|Space for a photo|2|romantic|w
🌙|Crescent moon earrings|Little silver moons|2|cute,artsy|w
⭐|Star stud earrings|Gold-plated|1|cute|w
🐚|Shell anklet|Beachy and light|1|outdoorsy|w
⌚|Vintage watch|Leather strap|3|glam,practical|w
🎗️|Charm bracelet|Add a charm for each memory|2|cute,family|w
🧿|Evil eye bracelet|For good luck|1|cute|w
🖤|Choker|Black velvet|1|glam,music|w
🌹|Rose gold necklace|Elegant chain|3|romantic,glam|w
🪶|Feather earrings|Boho style|1|artsy|w
💠|Sapphire ring|Deep blue stone|4|luxury,glam|w
🍀|Clover pendant|Lucky charm|1|cute|w
🎵|Music note necklace|For music lovers|1|music|w
🐱|Cat ear studs|Tiny and cute|1|cute|w
🏅|Engraved dog tag|A message of your choice|2|sporty|w
👑|Tiara|For a princess moment|3|glam,cute|w
🔗|Chunky chain|Silver statement piece|2|glam|w
🌼|Pressed flower pendant|Real daisy in resin|1|nature,cute|w
💫|Birthstone ring|Their month's stone|2|family,cute|w`,
  seasonal: `
🎃|Pumpkin spice candle|Smells like autumn|1|cosy,festive,spooky
👻|Ghost plushie|Boo, but cute|1|spooky,cute
🦇|Bat fairy lights|Halloween glow|1|spooky,cosy
🧙|Witch hat|Pointy and proud|1|spooky|w
🍂|Autumn wreath|Leaves and berries|2|cosy,nature,festive
🎄|Christmas jumper|Reindeer and snowflakes|2|festive,cosy,family|w
🎅|Advent calendar|A treat a day|2|festive,family,foodie
⛄|Snow globe|Shake it gently|1|festive,cute
🧦|Christmas stocking|Ready to fill|1|festive,family
🎁|Gift wrap bundle|Paper, ribbons, tags|1|festive,practical
🌟|Tree topper star|Gold and glittery|1|festive
🍪|Gingerbread kit|Build a house|1|festive,foodie,family
💝|Valentine's card|Hand-painted hearts|1|romantic,festive
🌷|Spring bulbs|Daffodils and crocus|1|nature,festive
🐣|Chocolate egg|Easter treat|1|foodie,festive,family
☀️|Beach towel|Stripy and huge|1|outdoorsy,festive
🏖️|Beach day kit|Bucket, spade, frisbee|2|outdoorsy,family
🎆|Sparklers|For bonfire night|1|festive,family
🧣|Tartan blanket scarf|Winter warmth|2|cosy,festive|w
☕|Festive mug|Snowy village|1|cosy,festive
🎊|Party poppers|New year fun|1|festive,family
🕯️|Cinnamon candle|Christmas in a jar|1|cosy,festive
🧤|Snowflake mittens|Fluffy lined|1|cosy,festive|w
🦃|Harvest pie|Apple and cinnamon|1|foodie,festive,family
🌕|Mooncake box|Mid-autumn treats|2|foodie,festive,family`,
};
