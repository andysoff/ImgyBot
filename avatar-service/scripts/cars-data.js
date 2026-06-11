// CAR_BRANDS — марки и модели автомобилей (стиль «Около машины»)
// Отсортировано по алфавиту (латиница → кириллица)
// Last sorted: 2026-06-11
const CAR_BRANDS = [
  {
    "id": "abarth",
    "name": "Abarth",
    "prompt": "Abarth",
    "models": [
      {
        "id": "595",
        "name": "595",
        "prompt": "Abarth 595, hot hatch"
      },
      {
        "id": "124_rally",
        "name": "124 Rally",
        "prompt": "Abarth 124 Rally, rally car"
      }
    ]
  },
  {
    "id": "acura",
    "name": "Acura",
    "prompt": "Acura",
    "models": [
      {
        "id": "mdx",
        "name": "MDX",
        "prompt": "Acura MDX, mid-size luxury SUV"
      },
      {
        "id": "rdx",
        "name": "RDX",
        "prompt": "Acura RDX, compact luxury SUV"
      },
      {
        "id": "tlx",
        "name": "TLX",
        "prompt": "Acura TLX, compact luxury sedan"
      },
      {
        "id": "integra",
        "name": "Integra",
        "prompt": "Acura Integra, sporty luxury hatchback"
      },
      {
        "id": "nsx_acura",
        "name": "NSX",
        "prompt": "Acura NSX, hybrid supercar"
      }
    ]
  },
  {
    "id": "alfa_romeo",
    "name": "Alfa Romeo",
    "prompt": "Alfa Romeo",
    "models": [
      {
        "id": "giulia",
        "name": "Giulia",
        "prompt": "Alfa Romeo Giulia, sports sedan"
      },
      {
        "id": "stelvio",
        "name": "Stelvio",
        "prompt": "Alfa Romeo Stelvio, compact luxury SUV"
      },
      {
        "id": "giulietta",
        "name": "Giulietta",
        "prompt": "Alfa Romeo Giulietta, compact hatchback"
      },
      {
        "id": "4c",
        "name": "4C",
        "prompt": "Alfa Romeo 4C, mid-engine sports car"
      },
      {
        "id": "tonale",
        "name": "Tonale",
        "prompt": "Alfa Romeo Tonale, compact crossover"
      },
      {
        "id": "spider",
        "name": "Spider",
        "prompt": "Alfa Romeo Spider, convertible"
      }
    ]
  },
  {
    "id": "alpine",
    "name": "Alpine",
    "prompt": "Alpine",
    "models": [
      {
        "id": "a110",
        "name": "A110",
        "prompt": "Alpine A110, sports coupe"
      },
      {
        "id": "a290",
        "name": "A290",
        "prompt": "Alpine A290, electric hot hatch"
      }
    ]
  },
  {
    "id": "aston_martin",
    "name": "Aston Martin",
    "prompt": "Aston Martin",
    "models": [
      {
        "id": "db11",
        "name": "DB11",
        "prompt": "Aston Martin DB11, grand tourer"
      },
      {
        "id": "dbs",
        "name": "DBS",
        "prompt": "Aston Martin DBS, super grand tourer"
      },
      {
        "id": "vantage",
        "name": "Vantage",
        "prompt": "Aston Martin Vantage, sports car"
      },
      {
        "id": "dbx",
        "name": "DBX",
        "prompt": "Aston Martin DBX, luxury SUV"
      },
      {
        "id": "valkyrie",
        "name": "Valkyrie",
        "prompt": "Aston Martin Valkyrie, hypercar"
      },
      {
        "id": "db5",
        "name": "DB5",
        "prompt": "Aston Martin DB5, iconic James Bond car"
      }
    ]
  },
  {
    "id": "audi",
    "name": "Audi",
    "prompt": "Audi",
    "models": [
      {
        "id": "a3",
        "name": "A3",
        "prompt": "Audi A3, compact luxury sedan"
      },
      {
        "id": "a4",
        "name": "A4",
        "prompt": "Audi A4, compact executive sedan"
      },
      {
        "id": "a6",
        "name": "A6",
        "prompt": "Audi A6, mid-size executive sedan"
      },
      {
        "id": "a8",
        "name": "A8",
        "prompt": "Audi A8, flagship luxury sedan"
      },
      {
        "id": "q5",
        "name": "Q5",
        "prompt": "Audi Q5, compact luxury SUV"
      },
      {
        "id": "q7",
        "name": "Q7",
        "prompt": "Audi Q7, mid-size luxury SUV"
      },
      {
        "id": "r8",
        "name": "R8",
        "prompt": "Audi R8, mid-engine supercar"
      },
      {
        "id": "e_tron",
        "name": "e-tron",
        "prompt": "Audi e-tron, all-electric luxury SUV"
      },
      {
        "id": "tt",
        "name": "TT",
        "prompt": "Audi TT, compact sports car"
      },
      {
        "id": "q3",
        "name": "Q3",
        "prompt": "Audi Q3, subcompact luxury SUV"
      }
    ]
  },
  {
    "id": "bentley",
    "name": "Bentley",
    "prompt": "Bentley",
    "models": [
      {
        "id": "continental_gt",
        "name": "Continental GT",
        "prompt": "Bentley Continental GT, luxury grand tourer"
      },
      {
        "id": "flying_spur",
        "name": "Flying Spur",
        "prompt": "Bentley Flying Spur, ultra-luxury sedan"
      },
      {
        "id": "bentayga",
        "name": "Bentayga",
        "prompt": "Bentley Bentayga, luxury SUV"
      },
      {
        "id": "mulsanne",
        "name": "Mulsanne",
        "prompt": "Bentley Mulsanne, flagship luxury sedan"
      },
      {
        "id": "azure",
        "name": "Azure",
        "prompt": "Bentley Azure, luxury convertible"
      }
    ]
  },
  {
    "id": "bmw",
    "name": "BMW",
    "prompt": "BMW",
    "models": [
      {
        "id": "3_series",
        "name": "3 Series",
        "prompt": "BMW 3 Series, sports sedan"
      },
      {
        "id": "5_series",
        "name": "5 Series",
        "prompt": "BMW 5 Series, executive sedan"
      },
      {
        "id": "7_series",
        "name": "7 Series",
        "prompt": "BMW 7 Series, flagship luxury sedan"
      },
      {
        "id": "x3",
        "name": "X3",
        "prompt": "BMW X3, compact SUV"
      },
      {
        "id": "x5",
        "name": "X5",
        "prompt": "BMW X5, mid-size luxury SUV"
      },
      {
        "id": "m3",
        "name": "M3",
        "prompt": "BMW M3, high-performance sports sedan"
      },
      {
        "id": "m5",
        "name": "M5",
        "prompt": "BMW M5, high-performance executive sedan"
      },
      {
        "id": "x1",
        "name": "X1",
        "prompt": "BMW X1, subcompact SUV"
      },
      {
        "id": "z4",
        "name": "Z4",
        "prompt": "BMW Z4, convertible roadster"
      },
      {
        "id": "i4",
        "name": "i4",
        "prompt": "BMW i4, electric gran coupe"
      }
    ]
  },
  {
    "id": "bmw_motorrad",
    "name": "BMW (Motorcycle)",
    "prompt": "BMW Motorrad",
    "models": [
      {
        "id": "r1250gs",
        "name": "R 1250 GS",
        "prompt": "BMW R 1250 GS, adventure touring motorcycle"
      },
      {
        "id": "s1000rr",
        "name": "S 1000 RR",
        "prompt": "BMW S 1000 RR, superbike"
      },
      {
        "id": "k1600",
        "name": "K 1600",
        "prompt": "BMW K 1600, luxury touring motorcycle"
      }
    ]
  },
  {
    "id": "bugatti",
    "name": "Bugatti",
    "prompt": "Bugatti",
    "models": [
      {
        "id": "chiron",
        "name": "Chiron",
        "prompt": "Bugatti Chiron, 1500 hp hypercar"
      },
      {
        "id": "veyron",
        "name": "Veyron",
        "prompt": "Bugatti Veyron, first 1000 hp production car"
      },
      {
        "id": "divo",
        "name": "Divo",
        "prompt": "Bugatti Divo, track-focused hypercar"
      },
      {
        "id": "mistral",
        "name": "Mistral",
        "prompt": "Bugatti Mistral, roadster hypercar"
      }
    ]
  },
  {
    "id": "byd",
    "name": "BYD",
    "prompt": "BYD",
    "models": [
      {
        "id": "song_plus",
        "name": "Song Plus",
        "prompt": "BYD Song Plus, plug-in hybrid SUV"
      },
      {
        "id": "han",
        "name": "Han",
        "prompt": "BYD Han, electric luxury sedan"
      },
      {
        "id": "tang",
        "name": "Tang",
        "prompt": "BYD Tang, electric SUV"
      },
      {
        "id": "atto_3",
        "name": "Atto 3",
        "prompt": "BYD Atto 3, electric compact SUV"
      },
      {
        "id": "dolphin",
        "name": "Dolphin",
        "prompt": "BYD Dolphin, electric hatchback"
      },
      {
        "id": "seal",
        "name": "Seal",
        "prompt": "BYD Seal, electric sports sedan"
      },
      {
        "id": "seagull",
        "name": "Seagull",
        "prompt": "BYD Seagull, affordable electric city car"
      }
    ]
  },
  {
    "id": "cadillac",
    "name": "Cadillac",
    "prompt": "Cadillac",
    "models": [
      {
        "id": "escalade",
        "name": "Escalade",
        "prompt": "Cadillac Escalade, full-size luxury SUV"
      },
      {
        "id": "ct5",
        "name": "CT5",
        "prompt": "Cadillac CT5, mid-size luxury sedan"
      },
      {
        "id": "xt5",
        "name": "XT5",
        "prompt": "Cadillac XT5, mid-size luxury SUV"
      },
      {
        "id": "lyriq",
        "name": "Lyriq",
        "prompt": "Cadillac Lyriq, all-electric luxury SUV"
      },
      {
        "id": "ct4",
        "name": "CT4",
        "prompt": "Cadillac CT4, compact luxury sedan"
      },
      {
        "id": "xt4",
        "name": "XT4",
        "prompt": "Cadillac XT4, compact luxury SUV"
      }
    ]
  },
  {
    "id": "caterham",
    "name": "Caterham",
    "prompt": "Caterham",
    "models": [
      {
        "id": "seven",
        "name": "Seven",
        "prompt": "Caterham Seven, lightweight British sports car"
      },
      {
        "id": "seven_420",
        "name": "Seven 420",
        "prompt": "Caterham Seven 420, performance variant"
      }
    ]
  },
  {
    "id": "chery",
    "name": "Chery",
    "prompt": "Chery",
    "models": [
      {
        "id": "tiggo_7",
        "name": "Tiggo 7",
        "prompt": "Chery Tiggo 7, compact SUV"
      },
      {
        "id": "tiggo_8",
        "name": "Tiggo 8",
        "prompt": "Chery Tiggo 8, mid-size SUV"
      },
      {
        "id": "tiggo_4",
        "name": "Tiggo 4",
        "prompt": "Chery Tiggo 4, subcompact SUV"
      },
      {
        "id": "exeed_txl",
        "name": "Exeed TXL",
        "prompt": "Chery Exeed TXL, luxury SUV"
      },
      {
        "id": "arrizo_8",
        "name": "Arrizo 8",
        "prompt": "Chery Arrizo 8, mid-size sedan"
      }
    ]
  },
  {
    "id": "chevrolet",
    "name": "Chevrolet",
    "prompt": "Chevrolet",
    "models": [
      {
        "id": "corvette",
        "name": "Corvette",
        "prompt": "Chevrolet Corvette, American sports car"
      },
      {
        "id": "camaro",
        "name": "Camaro",
        "prompt": "Chevrolet Camaro, muscle car"
      },
      {
        "id": "silverado",
        "name": "Silverado",
        "prompt": "Chevrolet Silverado, full-size pickup"
      },
      {
        "id": "tahoe",
        "name": "Tahoe",
        "prompt": "Chevrolet Tahoe, full-size SUV"
      },
      {
        "id": "malibu",
        "name": "Malibu",
        "prompt": "Chevrolet Malibu, mid-size sedan"
      },
      {
        "id": "suburban",
        "name": "Suburban",
        "prompt": "Chevrolet Suburban, extra-large SUV"
      },
      {
        "id": "traverse",
        "name": "Traverse",
        "prompt": "Chevrolet Traverse, mid-size crossover"
      },
      {
        "id": "equinox",
        "name": "Equinox",
        "prompt": "Chevrolet Equinox, compact SUV"
      },
      {
        "id": "cruze",
        "name": "Cruze",
        "prompt": "Chevrolet Cruze, compact sedan"
      },
      {
        "id": "blazer",
        "name": "Blazer",
        "prompt": "Chevrolet Blazer, mid-size crossover"
      }
    ]
  },
  {
    "id": "citroen",
    "name": "Citroën",
    "prompt": "Citroen",
    "models": [
      {
        "id": "c3",
        "name": "C3",
        "prompt": "Citroën C3, supermini"
      },
      {
        "id": "c4",
        "name": "C4",
        "prompt": "Citroën C4, compact hatchback"
      },
      {
        "id": "c5_aircross",
        "name": "C5 Aircross",
        "prompt": "Citroën C5 Aircross, compact SUV"
      },
      {
        "id": "berlingo",
        "name": "Berlingo",
        "prompt": "Citroën Berlingo, MPV"
      },
      {
        "id": "c3_aircross",
        "name": "C3 Aircross",
        "prompt": "Citroën C3 Aircross, subcompact SUV"
      }
    ]
  },
  {
    "id": "dacia",
    "name": "Dacia",
    "prompt": "Dacia",
    "models": [
      {
        "id": "duster",
        "name": "Duster",
        "prompt": "Dacia Duster, affordable SUV"
      },
      {
        "id": "sandero",
        "name": "Sandero",
        "prompt": "Dacia Sandero, budget hatchback"
      },
      {
        "id": "logan",
        "name": "Logan",
        "prompt": "Dacia Logan, budget sedan"
      },
      {
        "id": "spring",
        "name": "Spring",
        "prompt": "Dacia Spring, affordable electric car"
      },
      {
        "id": "jogger",
        "name": "Jogger",
        "prompt": "Dacia Jogger, family MPV"
      }
    ]
  },
  {
    "id": "dodge",
    "name": "Dodge",
    "prompt": "Dodge",
    "models": [
      {
        "id": "charger",
        "name": "Charger",
        "prompt": "Dodge Charger, full-size muscle sedan"
      },
      {
        "id": "challenger",
        "name": "Challenger",
        "prompt": "Dodge Challenger, muscle car"
      },
      {
        "id": "durango",
        "name": "Durango",
        "prompt": "Dodge Durango, mid-size SUV"
      },
      {
        "id": "viper",
        "name": "Viper",
        "prompt": "Dodge Viper, V10 American supercar"
      },
      {
        "id": "grand_caravan",
        "name": "Grand Caravan",
        "prompt": "Dodge Grand Caravan, minivan"
      }
    ]
  },
  {
    "id": "ferrari",
    "name": "Ferrari",
    "prompt": "Ferrari",
    "models": [
      {
        "id": "f8_tributo",
        "name": "F8 Tributo",
        "prompt": "Ferrari F8 Tributo, twin-turbo V8 supercar"
      },
      {
        "id": "sf90",
        "name": "SF90 Stradale",
        "prompt": "Ferrari SF90 Stradale, hybrid supercar"
      },
      {
        "id": "812_superfast",
        "name": "812 Superfast",
        "prompt": "Ferrari 812 Superfast, V12 grand tourer"
      },
      {
        "id": "portofino",
        "name": "Portofino",
        "prompt": "Ferrari Portofino, V8 convertible"
      },
      {
        "id": "roma",
        "name": "Roma",
        "prompt": "Ferrari Roma, V8 coupe"
      },
      {
        "id": "296_gtb",
        "name": "296 GTB",
        "prompt": "Ferrari 296 GTB, hybrid V6 supercar"
      },
      {
        "id": "laferrari",
        "name": "LaFerrari",
        "prompt": "Ferrari LaFerrari, limited edition hybrid hypercar"
      },
      {
        "id": "purosangue",
        "name": "Purosangue",
        "prompt": "Ferrari Purosangue, first Ferrari SUV"
      }
    ]
  },
  {
    "id": "fiat",
    "name": "Fiat",
    "prompt": "Fiat",
    "models": [
      {
        "id": "500",
        "name": "500",
        "prompt": "Fiat 500, iconic city car"
      },
      {
        "id": "panda",
        "name": "Panda",
        "prompt": "Fiat Panda, practical city car"
      },
      {
        "id": "tipo",
        "name": "Tipo",
        "prompt": "Fiat Tipo, compact car"
      },
      {
        "id": "ducato",
        "name": "Ducato",
        "prompt": "Fiat Ducato, large van"
      },
      {
        "id": "124_spider",
        "name": "124 Spider",
        "prompt": "Fiat 124 Spider, convertible roadster"
      },
      {
        "id": "pulse",
        "name": "Pulse",
        "prompt": "Fiat Pulse, subcompact crossover"
      }
    ]
  },
  {
    "id": "fisker",
    "name": "Fisker",
    "prompt": "Fisker",
    "models": [
      {
        "id": "ocean",
        "name": "Ocean",
        "prompt": "Fisker Ocean, electric SUV"
      },
      {
        "id": "pear",
        "name": "PEAR",
        "prompt": "Fisker PEAR, compact electric vehicle"
      }
    ]
  },
  {
    "id": "ford",
    "name": "Ford",
    "prompt": "Ford",
    "models": [
      {
        "id": "mustang",
        "name": "Mustang",
        "prompt": "Ford Mustang, American muscle car"
      },
      {
        "id": "f150",
        "name": "F-150",
        "prompt": "Ford F-150, best-selling pickup truck"
      },
      {
        "id": "explorer",
        "name": "Explorer",
        "prompt": "Ford Explorer, mid-size SUV"
      },
      {
        "id": "bronco",
        "name": "Bronco",
        "prompt": "Ford Bronco, off-road SUV"
      },
      {
        "id": "focus",
        "name": "Focus",
        "prompt": "Ford Focus, compact car"
      },
      {
        "id": "escape",
        "name": "Escape",
        "prompt": "Ford Escape, compact crossover"
      },
      {
        "id": "ranger",
        "name": "Ranger",
        "prompt": "Ford Ranger, mid-size pickup"
      },
      {
        "id": "transit",
        "name": "Transit",
        "prompt": "Ford Transit, cargo van"
      },
      {
        "id": "mondeo",
        "name": "Mondeo",
        "prompt": "Ford Mondeo, mid-size sedan"
      },
      {
        "id": "gt",
        "name": "GT",
        "prompt": "Ford GT, supercar"
      }
    ]
  },
  {
    "id": "geely",
    "name": "Geely",
    "prompt": "Geely",
    "models": [
      {
        "id": "monjaro",
        "name": "Monjaro",
        "prompt": "Geely Monjaro, flagship SUV"
      },
      {
        "id": "coolray",
        "name": "Coolray",
        "prompt": "Geely Coolray, subcompact crossover"
      },
      {
        "id": "atlas",
        "name": "Atlas",
        "prompt": "Geely Atlas, compact SUV"
      },
      {
        "id": "tugella",
        "name": "Tugella",
        "prompt": "Geely Tugella, coupe SUV"
      },
      {
        "id": "emgrand",
        "name": "Emgrand",
        "prompt": "Geely Emgrand, compact sedan"
      }
    ]
  },
  {
    "id": "genesis",
    "name": "Genesis",
    "prompt": "Genesis",
    "models": [
      {
        "id": "g80",
        "name": "G80",
        "prompt": "Genesis G80, mid-size luxury sedan"
      },
      {
        "id": "g90",
        "name": "G90",
        "prompt": "Genesis G90, flagship luxury sedan"
      },
      {
        "id": "gv70",
        "name": "GV70",
        "prompt": "Genesis GV70, compact luxury SUV"
      },
      {
        "id": "gv80",
        "name": "GV80",
        "prompt": "Genesis GV80, mid-size luxury SUV"
      },
      {
        "id": "g70",
        "name": "G70",
        "prompt": "Genesis G70, compact sports sedan"
      }
    ]
  },
  {
    "id": "gmc",
    "name": "GMC",
    "prompt": "GMC",
    "models": [
      {
        "id": "sierra",
        "name": "Sierra",
        "prompt": "GMC Sierra, full-size pickup"
      },
      {
        "id": "yukon",
        "name": "Yukon",
        "prompt": "GMC Yukon, full-size SUV"
      },
      {
        "id": "acadia",
        "name": "Acadia",
        "prompt": "GMC Acadia, mid-size SUV"
      },
      {
        "id": "terrain",
        "name": "Terrain",
        "prompt": "GMC Terrain, compact SUV"
      },
      {
        "id": "canyon",
        "name": "Canyon",
        "prompt": "GMC Canyon, mid-size pickup"
      },
      {
        "id": "hummer_ev",
        "name": "Hummer EV",
        "prompt": "GMC Hummer EV, all-electric supertruck"
      }
    ]
  },
  {
    "id": "great_wall",
    "name": "Great Wall",
    "prompt": "Great Wall",
    "models": [
      {
        "id": "haval_h6",
        "name": "Haval H6",
        "prompt": "Great Wall Haval H6, popular Chinese SUV"
      },
      {
        "id": "haval_jolion",
        "name": "Haval Jolion",
        "prompt": "Great Wall Haval Jolion, compact crossover"
      },
      {
        "id": "wey_01",
        "name": "Wey 01",
        "prompt": "Great Wall Wey 01, luxury SUV"
      },
      {
        "id": "ora_03",
        "name": "Ora 03",
        "prompt": "Great Wall Ora 03, retro-style electric car"
      },
      {
        "id": "gwm_poer",
        "name": "Poer",
        "prompt": "Great Wall Poer, pickup truck"
      }
    ]
  },
  {
    "id": "harley_davidson",
    "name": "Harley-Davidson",
    "prompt": "Harley-Davidson",
    "models": [
      {
        "id": "street_glide",
        "name": "Street Glide",
        "prompt": "Harley-Davidson Street Glide, touring cruiser"
      },
      {
        "id": "iron_883",
        "name": "Iron 883",
        "prompt": "Harley-Davidson Iron 883, Sportster cruiser"
      },
      {
        "id": "road_king",
        "name": "Road King",
        "prompt": "Harley-Davidson Road King, classic cruiser"
      },
      {
        "id": "fat_boy",
        "name": "Fat Boy",
        "prompt": "Harley-Davidson Fat Boy, iconic cruiser"
      }
    ]
  },
  {
    "id": "honda",
    "name": "Honda",
    "prompt": "Honda",
    "models": [
      {
        "id": "accord",
        "name": "Accord",
        "prompt": "Honda Accord, spacious mid-size sedan"
      },
      {
        "id": "civic",
        "name": "Civic",
        "prompt": "Honda Civic, popular compact car"
      },
      {
        "id": "crv",
        "name": "CR-V",
        "prompt": "Honda CR-V, compact SUV"
      },
      {
        "id": "pilot",
        "name": "Pilot",
        "prompt": "Honda Pilot, mid-size SUV"
      },
      {
        "id": "nsx",
        "name": "NSX",
        "prompt": "Honda NSX, supercar with hybrid powertrain"
      },
      {
        "id": "odyssey",
        "name": "Odyssey",
        "prompt": "Honda Odyssey, minivan"
      },
      {
        "id": "hrv",
        "name": "HR-V",
        "prompt": "Honda HR-V, subcompact crossover"
      },
      {
        "id": "fit",
        "name": "Fit/Jazz",
        "prompt": "Honda Fit, subcompact hatchback"
      },
      {
        "id": "ridgeline",
        "name": "Ridgeline",
        "prompt": "Honda Ridgeline, pickup truck"
      },
      {
        "id": "passport",
        "name": "Passport",
        "prompt": "Honda Passport, rugged SUV"
      }
    ]
  },
  {
    "id": "hyundai",
    "name": "Hyundai",
    "prompt": "Hyundai",
    "models": [
      {
        "id": "elantra",
        "name": "Elantra",
        "prompt": "Hyundai Elantra, compact sedan"
      },
      {
        "id": "tucson",
        "name": "Tucson",
        "prompt": "Hyundai Tucson, compact SUV"
      },
      {
        "id": "santa_fe",
        "name": "Santa Fe",
        "prompt": "Hyundai Santa Fe, mid-size SUV"
      },
      {
        "id": "sonata",
        "name": "Sonata",
        "prompt": "Hyundai Sonata, mid-size sedan"
      },
      {
        "id": "kona",
        "name": "Kona",
        "prompt": "Hyundai Kona, subcompact crossover"
      },
      {
        "id": "palisade",
        "name": "Palisade",
        "prompt": "Hyundai Palisade, full-size SUV"
      },
      {
        "id": "ioniq_5",
        "name": "Ioniq 5",
        "prompt": "Hyundai Ioniq 5, all-electric crossover"
      },
      {
        "id": "i30",
        "name": "i30",
        "prompt": "Hyundai i30, compact hatchback"
      },
      {
        "id": "veloster",
        "name": "Veloster",
        "prompt": "Hyundai Veloster, quirky sports coupe"
      },
      {
        "id": "nexo",
        "name": "Nexo",
        "prompt": "Hyundai Nexo, hydrogen fuel cell SUV"
      }
    ]
  },
  {
    "id": "infiniti",
    "name": "Infiniti",
    "prompt": "Infiniti",
    "models": [
      {
        "id": "q50",
        "name": "Q50",
        "prompt": "Infiniti Q50, compact sports sedan"
      },
      {
        "id": "qx60",
        "name": "QX60",
        "prompt": "Infiniti QX60, mid-size luxury SUV"
      },
      {
        "id": "qx80",
        "name": "QX80",
        "prompt": "Infiniti QX80, full-size luxury SUV"
      },
      {
        "id": "q60",
        "name": "Q60",
        "prompt": "Infiniti Q60, luxury coupe"
      },
      {
        "id": "qx50",
        "name": "QX50",
        "prompt": "Infiniti QX50, compact luxury SUV"
      }
    ]
  },
  {
    "id": "jaguar",
    "name": "Jaguar",
    "prompt": "Jaguar",
    "models": [
      {
        "id": "ftype",
        "name": "F-Type",
        "prompt": "Jaguar F-Type, sports car"
      },
      {
        "id": "xf",
        "name": "XF",
        "prompt": "Jaguar XF, mid-size sports sedan"
      },
      {
        "id": "fpace",
        "name": "F-Pace",
        "prompt": "Jaguar F-Pace, performance SUV"
      },
      {
        "id": "ipace",
        "name": "I-Pace",
        "prompt": "Jaguar I-Pace, all-electric SUV"
      },
      {
        "id": "xj",
        "name": "XJ",
        "prompt": "Jaguar XJ, flagship luxury sedan"
      },
      {
        "id": "epace",
        "name": "E-Pace",
        "prompt": "Jaguar E-Pace, compact SUV"
      }
    ]
  },
  {
    "id": "jeep",
    "name": "Jeep",
    "prompt": "Jeep",
    "models": [
      {
        "id": "wrangler",
        "name": "Wrangler",
        "prompt": "Jeep Wrangler, iconic off-road SUV"
      },
      {
        "id": "grand_cherokee",
        "name": "Grand Cherokee",
        "prompt": "Jeep Grand Cherokee, mid-size SUV"
      },
      {
        "id": "cherokee",
        "name": "Cherokee",
        "prompt": "Jeep Cherokee, compact SUV"
      },
      {
        "id": "renegade",
        "name": "Renegade",
        "prompt": "Jeep Renegade, subcompact SUV"
      },
      {
        "id": "compass",
        "name": "Compass",
        "prompt": "Jeep Compass, compact crossover"
      },
      {
        "id": "gladiator",
        "name": "Gladiator",
        "prompt": "Jeep Gladiator, pickup truck"
      },
      {
        "id": "patriot",
        "name": "Patriot",
        "prompt": "Jeep Patriot, compact SUV"
      }
    ]
  },
  {
    "id": "kia",
    "name": "Kia",
    "prompt": "Kia",
    "models": [
      {
        "id": "sportage",
        "name": "Sportage",
        "prompt": "Kia Sportage, compact SUV"
      },
      {
        "id": "sorento",
        "name": "Sorento",
        "prompt": "Kia Sorento, mid-size SUV"
      },
      {
        "id": "rio",
        "name": "Rio",
        "prompt": "Kia Rio, subcompact car"
      },
      {
        "id": "ceed",
        "name": "Ceed",
        "prompt": "Kia Ceed, compact hatchback"
      },
      {
        "id": "telluride",
        "name": "Telluride",
        "prompt": "Kia Telluride, full-size SUV"
      },
      {
        "id": "ev6",
        "name": "EV6",
        "prompt": "Kia EV6, all-electric crossover"
      },
      {
        "id": "stinger",
        "name": "Stinger",
        "prompt": "Kia Stinger, sports sedan"
      },
      {
        "id": "soul",
        "name": "Soul",
        "prompt": "Kia Soul, boxy subcompact car"
      },
      {
        "id": "picanto",
        "name": "Picanto",
        "prompt": "Kia Picanto, city car"
      },
      {
        "id": "carnival",
        "name": "Carnival",
        "prompt": "Kia Carnival, minivan"
      }
    ]
  },
  {
    "id": "skoda",
    "name": "Škoda",
    "prompt": "Skoda",
    "models": [
      {
        "id": "octavia",
        "name": "Octavia",
        "prompt": "Škoda Octavia, spacious compact car"
      },
      {
        "id": "superb",
        "name": "Superb",
        "prompt": "Škoda Superb, flagship sedan"
      },
      {
        "id": "kodiaq",
        "name": "Kodiaq",
        "prompt": "Škoda Kodiaq, mid-size SUV"
      },
      {
        "id": "fabia",
        "name": "Fabia",
        "prompt": "Škoda Fabia, supermini"
      },
      {
        "id": "karoq",
        "name": "Karoq",
        "prompt": "Škoda Karoq, compact SUV"
      },
      {
        "id": "kamiq",
        "name": "Kamiq",
        "prompt": "Škoda Kamiq, subcompact SUV"
      },
      {
        "id": "enyaq",
        "name": "Enyaq",
        "prompt": "Škoda Enyaq, all-electric SUV"
      }
    ]
  },
  {
    "id": "koenigsegg",
    "name": "Koenigsegg",
    "prompt": "Koenigsegg",
    "models": [
      {
        "id": "jesko",
        "name": "Jesko",
        "prompt": "Koenigsegg Jesko, 1600 hp hypercar"
      },
      {
        "id": "regera",
        "name": "Regera",
        "prompt": "Koenigsegg Regera, hybrid hypercar without gearbox"
      },
      {
        "id": "agera",
        "name": "Agera",
        "prompt": "Koenigsegg Agera, hypercar"
      },
      {
        "id": "gemera",
        "name": "Gemera",
        "prompt": "Koenigsegg Gemera, four-seat hypercar"
      },
      {
        "id": "ccx",
        "name": "CCX",
        "prompt": "Koenigsegg CCX, early hypercar"
      }
    ]
  },
  {
    "id": "lada",
    "name": "Lada",
    "prompt": "Lada",
    "models": [
      {
        "id": "vesta",
        "name": "Vesta",
        "prompt": "Lada Vesta, popular Russian sedan"
      },
      {
        "id": "granta",
        "name": "Granta",
        "prompt": "Lada Granta, affordable Russian car"
      },
      {
        "id": "largus",
        "name": "Largus",
        "prompt": "Lada Largus, station wagon"
      },
      {
        "id": "niva",
        "name": "Niva",
        "prompt": "Lada Niva, legendary Russian off-road SUV"
      },
      {
        "id": "xray",
        "name": "XRAY",
        "prompt": "Lada XRAY, compact crossover"
      },
      {
        "id": "kalina",
        "name": "Kalina",
        "prompt": "Lada Kalina, compact hatchback"
      }
    ]
  },
  {
    "id": "lamborghini",
    "name": "Lamborghini",
    "prompt": "Lamborghini",
    "models": [
      {
        "id": "aventador",
        "name": "Aventador",
        "prompt": "Lamborghini Aventador, V12 flagship supercar"
      },
      {
        "id": "huracan",
        "name": "Huracán",
        "prompt": "Lamborghini Huracán, V10 supercar"
      },
      {
        "id": "urus",
        "name": "Urus",
        "prompt": "Lamborghini Urus, super SUV"
      },
      {
        "id": "revuelto",
        "name": "Revuelto",
        "prompt": "Lamborghini Revuelto, hybrid V12 supercar"
      },
      {
        "id": "countach",
        "name": "Countach",
        "prompt": "Lamborghini Countach, legendary wedge-shaped supercar"
      },
      {
        "id": "gallardo",
        "name": "Gallardo",
        "prompt": "Lamborghini Gallardo, iconic V10 supercar"
      },
      {
        "id": "murcielago",
        "name": "Murciélago",
        "prompt": "Lamborghini Murciélago, V12 supercar"
      },
      {
        "id": "diablo",
        "name": "Diablo",
        "prompt": "Lamborghini Diablo, iconic 90s supercar"
      }
    ]
  },
  {
    "id": "lancia",
    "name": "Lancia",
    "prompt": "Lancia",
    "models": [
      {
        "id": "delta",
        "name": "Delta",
        "prompt": "Lancia Delta HF Integrale, rally legend"
      },
      {
        "id": "stratos",
        "name": "Stratos",
        "prompt": "Lancia Stratos, iconic rally car"
      },
      {
        "id": "ypsilon",
        "name": "Ypsilon",
        "prompt": "Lancia Ypsilon, city car"
      }
    ]
  },
  {
    "id": "land_rover",
    "name": "Land Rover",
    "prompt": "Land Rover",
    "models": [
      {
        "id": "range_rover",
        "name": "Range Rover",
        "prompt": "Range Rover, flagship luxury SUV"
      },
      {
        "id": "range_rover_sport",
        "name": "Range Rover Sport",
        "prompt": "Range Rover Sport, sporty luxury SUV"
      },
      {
        "id": "discovery",
        "name": "Discovery",
        "prompt": "Land Rover Discovery, family SUV"
      },
      {
        "id": "defender",
        "name": "Defender",
        "prompt": "Land Rover Defender, iconic off-road SUV"
      },
      {
        "id": "evoque",
        "name": "Evoque",
        "prompt": "Range Rover Evoque, compact luxury SUV"
      },
      {
        "id": "velar",
        "name": "Velar",
        "prompt": "Range Rover Velar, mid-size luxury SUV"
      },
      {
        "id": "freelander",
        "name": "Freelander",
        "prompt": "Land Rover Freelander, compact SUV"
      }
    ]
  },
  {
    "id": "lexus",
    "name": "Lexus",
    "prompt": "Lexus",
    "models": [
      {
        "id": "rx",
        "name": "RX",
        "prompt": "Lexus RX, luxury mid-size SUV"
      },
      {
        "id": "es",
        "name": "ES",
        "prompt": "Lexus ES, luxury mid-size sedan"
      },
      {
        "id": "nx",
        "name": "NX",
        "prompt": "Lexus NX, compact luxury SUV"
      },
      {
        "id": "ls",
        "name": "LS",
        "prompt": "Lexus LS, flagship luxury sedan"
      },
      {
        "id": "gx",
        "name": "GX",
        "prompt": "Lexus GX, body-on-frame luxury SUV"
      },
      {
        "id": "lx",
        "name": "LX",
        "prompt": "Lexus LX, full-size luxury SUV"
      },
      {
        "id": "ux",
        "name": "UX",
        "prompt": "Lexus UX, subcompact luxury crossover"
      },
      {
        "id": "is",
        "name": "IS",
        "prompt": "Lexus IS, compact luxury sedan"
      },
      {
        "id": "lc",
        "name": "LC",
        "prompt": "Lexus LC, luxury grand tourer"
      },
      {
        "id": "rc",
        "name": "RC",
        "prompt": "Lexus RC, luxury coupe"
      }
    ]
  },
  {
    "id": "li_auto",
    "name": "Li Auto",
    "prompt": "Li Auto",
    "models": [
      {
        "id": "l9",
        "name": "L9",
        "prompt": "Li Auto L9, large luxury SUV"
      },
      {
        "id": "l8",
        "name": "L8",
        "prompt": "Li Auto L8, mid-size luxury SUV"
      },
      {
        "id": "l7",
        "name": "L7",
        "prompt": "Li Auto L7, five-seat luxury SUV"
      },
      {
        "id": "mega",
        "name": "Mega",
        "prompt": "Li Auto Mega, all-electric MPV"
      }
    ]
  },
  {
    "id": "lincoln",
    "name": "Lincoln",
    "prompt": "Lincoln",
    "models": [
      {
        "id": "navigator",
        "name": "Navigator",
        "prompt": "Lincoln Navigator, full-size luxury SUV"
      },
      {
        "id": "aviator",
        "name": "Aviator",
        "prompt": "Lincoln Aviator, mid-size luxury SUV"
      },
      {
        "id": "corsair",
        "name": "Corsair",
        "prompt": "Lincoln Corsair, compact luxury SUV"
      },
      {
        "id": "continental",
        "name": "Continental",
        "prompt": "Lincoln Continental, full-size luxury sedan"
      },
      {
        "id": "mkz",
        "name": "MKZ",
        "prompt": "Lincoln MKZ, mid-size luxury sedan"
      }
    ]
  },
  {
    "id": "lotus",
    "name": "Lotus",
    "prompt": "Lotus",
    "models": [
      {
        "id": "emira",
        "name": "Emira",
        "prompt": "Lotus Emira, mid-engine sports car"
      },
      {
        "id": "evija",
        "name": "Evija",
        "prompt": "Lotus Evija, all-electric hypercar"
      },
      {
        "id": "elise",
        "name": "Elise",
        "prompt": "Lotus Elise, lightweight sports car"
      },
      {
        "id": "exige",
        "name": "Exige",
        "prompt": "Lotus Exige, hardcore sports car"
      },
      {
        "id": "eletre",
        "name": "Eletre",
        "prompt": "Lotus Eletre, electric SUV"
      }
    ]
  },
  {
    "id": "lucid",
    "name": "Lucid",
    "prompt": "Lucid",
    "models": [
      {
        "id": "air",
        "name": "Air",
        "prompt": "Lucid Air, luxury electric sedan"
      },
      {
        "id": "gravity",
        "name": "Gravity",
        "prompt": "Lucid Gravity, electric SUV"
      }
    ]
  },
  {
    "id": "maserati",
    "name": "Maserati",
    "prompt": "Maserati",
    "models": [
      {
        "id": "quattroporte",
        "name": "Quattroporte",
        "prompt": "Maserati Quattroporte, luxury sports sedan"
      },
      {
        "id": "levante",
        "name": "Levante",
        "prompt": "Maserati Levante, luxury SUV"
      },
      {
        "id": "ghibli",
        "name": "Ghibli",
        "prompt": "Maserati Ghibli, executive sports sedan"
      },
      {
        "id": "mc20",
        "name": "MC20",
        "prompt": "Maserati MC20, mid-engine supercar"
      },
      {
        "id": "granturismo",
        "name": "GranTurismo",
        "prompt": "Maserati GranTurismo, luxury grand tourer"
      },
      {
        "id": "grecale",
        "name": "Grecale",
        "prompt": "Maserati Grecale, compact luxury SUV"
      }
    ]
  },
  {
    "id": "mazda",
    "name": "Mazda",
    "prompt": "Mazda",
    "models": [
      {
        "id": "mx5",
        "name": "MX-5 Miata",
        "prompt": "Mazda MX-5 Miata, lightweight roadster"
      },
      {
        "id": "cx5",
        "name": "CX-5",
        "prompt": "Mazda CX-5, compact SUV"
      },
      {
        "id": "mazda3",
        "name": "Mazda3",
        "prompt": "Mazda3, compact car with upscale design"
      },
      {
        "id": "cx30",
        "name": "CX-30",
        "prompt": "Mazda CX-30, subcompact crossover"
      },
      {
        "id": "cx9",
        "name": "CX-9",
        "prompt": "Mazda CX-9, mid-size SUV"
      },
      {
        "id": "rx7",
        "name": "RX-7",
        "prompt": "Mazda RX-7, rotary-powered sports car"
      },
      {
        "id": "mazda6",
        "name": "Mazda6",
        "prompt": "Mazda6, mid-size sedan"
      },
      {
        "id": "mx30",
        "name": "MX-30",
        "prompt": "Mazda MX-30, electric crossover"
      },
      {
        "id": "cx60",
        "name": "CX-60",
        "prompt": "Mazda CX-60, plug-in hybrid SUV"
      }
    ]
  },
  {
    "id": "mclaren",
    "name": "McLaren",
    "prompt": "McLaren",
    "models": [
      {
        "id": "720s",
        "name": "720S",
        "prompt": "McLaren 720S, supercar"
      },
      {
        "id": "artura",
        "name": "Artura",
        "prompt": "McLaren Artura, hybrid supercar"
      },
      {
        "id": "senna",
        "name": "Senna",
        "prompt": "McLaren Senna, track-focused hypercar"
      },
      {
        "id": "p1",
        "name": "P1",
        "prompt": "McLaren P1, hybrid hypercar"
      },
      {
        "id": "765lt",
        "name": "765LT",
        "prompt": "McLaren 765LT, longtail supercar"
      },
      {
        "id": "gt",
        "name": "GT",
        "prompt": "McLaren GT, grand tourer"
      }
    ]
  },
  {
    "id": "mercedes",
    "name": "Mercedes-Benz",
    "prompt": "Mercedes-Benz",
    "models": [
      {
        "id": "s_class",
        "name": "S-Class",
        "prompt": "Mercedes-Benz S-Class, flagship luxury sedan"
      },
      {
        "id": "e_class",
        "name": "E-Class",
        "prompt": "Mercedes-Benz E-Class, executive sedan"
      },
      {
        "id": "c_class",
        "name": "C-Class",
        "prompt": "Mercedes-Benz C-Class, entry-level luxury sedan"
      },
      {
        "id": "gle",
        "name": "GLE",
        "prompt": "Mercedes-Benz GLE, mid-size luxury SUV"
      },
      {
        "id": "glc",
        "name": "GLC",
        "prompt": "Mercedes-Benz GLC, compact luxury SUV"
      },
      {
        "id": "g_class",
        "name": "G-Class",
        "prompt": "Mercedes-Benz G-Class, iconic off-road SUV"
      },
      {
        "id": "a_class",
        "name": "A-Class",
        "prompt": "Mercedes-Benz A-Class, compact hatchback"
      },
      {
        "id": "cls",
        "name": "CLS",
        "prompt": "Mercedes-Benz CLS, four-door coupe"
      },
      {
        "id": "gls",
        "name": "GLS",
        "prompt": "Mercedes-Benz GLS, full-size luxury SUV"
      },
      {
        "id": "amg_gt",
        "name": "AMG GT",
        "prompt": "Mercedes-AMG GT, high-performance sports car"
      }
    ]
  },
  {
    "id": "mg",
    "name": "MG",
    "prompt": "MG",
    "models": [
      {
        "id": "zs",
        "name": "ZS",
        "prompt": "MG ZS, compact SUV"
      },
      {
        "id": "hs",
        "name": "HS",
        "prompt": "MG HS, mid-size SUV"
      },
      {
        "id": "mg4",
        "name": "MG4",
        "prompt": "MG4, all-electric hatchback"
      },
      {
        "id": "mg5",
        "name": "MG5",
        "prompt": "MG5, compact station wagon"
      },
      {
        "id": "cyberster",
        "name": "Cyberster",
        "prompt": "MG Cyberster, electric roadster"
      }
    ]
  },
  {
    "id": "mini",
    "name": "MINI",
    "prompt": "MINI",
    "models": [
      {
        "id": "cooper",
        "name": "Cooper",
        "prompt": "MINI Cooper, iconic British hatchback"
      },
      {
        "id": "countryman",
        "name": "Countryman",
        "prompt": "MINI Countryman, crossover"
      },
      {
        "id": "clubman",
        "name": "Clubman",
        "prompt": "MINI Clubman, estate"
      },
      {
        "id": "paceman",
        "name": "Paceman",
        "prompt": "MINI Paceman, coupe SUV"
      },
      {
        "id": "roadster",
        "name": "Roadster",
        "prompt": "MINI Roadster, convertible"
      }
    ]
  },
  {
    "id": "mitsubishi",
    "name": "Mitsubishi",
    "prompt": "Mitsubishi",
    "models": [
      {
        "id": "outlander",
        "name": "Outlander",
        "prompt": "Mitsubishi Outlander, compact SUV"
      },
      {
        "id": "pajero",
        "name": "Pajero",
        "prompt": "Mitsubishi Pajero, off-road SUV"
      },
      {
        "id": "lancer_evo",
        "name": "Lancer Evolution",
        "prompt": "Mitsubishi Lancer Evolution, rally-bred sports sedan"
      },
      {
        "id": "asx",
        "name": "ASX",
        "prompt": "Mitsubishi ASX, subcompact crossover"
      },
      {
        "id": "eclipse_cross",
        "name": "Eclipse Cross",
        "prompt": "Mitsubishi Eclipse Cross, compact coupe SUV"
      },
      {
        "id": "montero",
        "name": "Montero",
        "prompt": "Mitsubishi Montero, full-size SUV"
      }
    ]
  },
  {
    "id": "morgan",
    "name": "Morgan",
    "prompt": "Morgan",
    "models": [
      {
        "id": "plus_four",
        "name": "Plus Four",
        "prompt": "Morgan Plus Four, classic British roadster"
      },
      {
        "id": "plus_six",
        "name": "Plus Six",
        "prompt": "Morgan Plus Six, modern retro roadster"
      },
      {
        "id": "super_three",
        "name": "Super 3",
        "prompt": "Morgan Super 3, three-wheeler"
      }
    ]
  },
  {
    "id": "neta",
    "name": "Neta",
    "prompt": "Neta",
    "models": [
      {
        "id": "neta_v",
        "name": "Neta V",
        "prompt": "Neta V, electric subcompact SUV"
      },
      {
        "id": "neta_u",
        "name": "Neta U",
        "prompt": "Neta U, electric compact SUV"
      },
      {
        "id": "neta_s",
        "name": "Neta S",
        "prompt": "Neta S, electric sports sedan"
      },
      {
        "id": "neta_gt",
        "name": "Neta GT",
        "prompt": "Neta GT, electric sports car"
      }
    ]
  },
  {
    "id": "nio",
    "name": "NIO",
    "prompt": "NIO",
    "models": [
      {
        "id": "et7",
        "name": "ET7",
        "prompt": "NIO ET7, electric luxury sedan"
      },
      {
        "id": "es6",
        "name": "ES6",
        "prompt": "NIO ES6, electric mid-size SUV"
      },
      {
        "id": "ec6",
        "name": "EC6",
        "prompt": "NIO EC6, electric coupe SUV"
      },
      {
        "id": "et5",
        "name": "ET5",
        "prompt": "NIO ET5, compact electric sedan"
      }
    ]
  },
  {
    "id": "nissan",
    "name": "Nissan",
    "prompt": "Nissan",
    "models": [
      {
        "id": "gtr",
        "name": "GT-R",
        "prompt": "Nissan GT-R, legendary Japanese supercar"
      },
      {
        "id": "altima",
        "name": "Altima",
        "prompt": "Nissan Altima, mid-size sedan"
      },
      {
        "id": "qashqai",
        "name": "Qashqai",
        "prompt": "Nissan Qashqai, compact crossover"
      },
      {
        "id": "xtrail",
        "name": "X-Trail",
        "prompt": "Nissan X-Trail, compact SUV"
      },
      {
        "id": "patrol",
        "name": "Patrol",
        "prompt": "Nissan Patrol, full-size off-road SUV"
      },
      {
        "id": "leaf",
        "name": "Leaf",
        "prompt": "Nissan Leaf, all-electric hatchback"
      },
      {
        "id": "juke",
        "name": "Juke",
        "prompt": "Nissan Juke, subcompact crossover"
      },
      {
        "id": "pathfinder",
        "name": "Pathfinder",
        "prompt": "Nissan Pathfinder, mid-size SUV"
      },
      {
        "id": "sentra",
        "name": "Sentra",
        "prompt": "Nissan Sentra, compact sedan"
      },
      {
        "id": "z",
        "name": "Z",
        "prompt": "Nissan Z, sports car"
      }
    ]
  },
  {
    "id": "opel",
    "name": "Opel",
    "prompt": "Opel",
    "models": [
      {
        "id": "corsa",
        "name": "Corsa",
        "prompt": "Opel Corsa, supermini"
      },
      {
        "id": "astra",
        "name": "Astra",
        "prompt": "Opel Astra, compact car"
      },
      {
        "id": "insignia",
        "name": "Insignia",
        "prompt": "Opel Insignia, mid-size sedan"
      },
      {
        "id": "mokka",
        "name": "Mokka",
        "prompt": "Opel Mokka, subcompact SUV"
      },
      {
        "id": "crossland",
        "name": "Crossland",
        "prompt": "Opel Crossland, compact crossover"
      },
      {
        "id": "grandland",
        "name": "Grandland",
        "prompt": "Opel Grandland, compact SUV"
      }
    ]
  },
  {
    "id": "pagani",
    "name": "Pagani",
    "prompt": "Pagani",
    "models": [
      {
        "id": "huayra",
        "name": "Huayra",
        "prompt": "Pagani Huayra, V12 Italian hypercar"
      },
      {
        "id": "zonda",
        "name": "Zonda",
        "prompt": "Pagani Zonda, iconic hypercar"
      },
      {
        "id": "utopia",
        "name": "Utopia",
        "prompt": "Pagani Utopia, latest V12 hypercar"
      }
    ]
  },
  {
    "id": "perodua",
    "name": "Perodua",
    "prompt": "Perodua",
    "models": [
      {
        "id": "myvi",
        "name": "Myvi",
        "prompt": "Perodua Myvi, popular Malaysian hatchback"
      },
      {
        "id": "axia",
        "name": "Axia",
        "prompt": "Perodua Axia, city car"
      },
      {
        "id": "bezza",
        "name": "Bezza",
        "prompt": "Perodua Bezza, compact sedan"
      },
      {
        "id": "alza",
        "name": "Alza",
        "prompt": "Perodua Alza, MPV"
      },
      {
        "id": "aruz",
        "name": "Aruz",
        "prompt": "Perodua Aruz, compact SUV"
      }
    ]
  },
  {
    "id": "peugeot",
    "name": "Peugeot",
    "prompt": "Peugeot",
    "models": [
      {
        "id": "208",
        "name": "208",
        "prompt": "Peugeot 208, supermini"
      },
      {
        "id": "308",
        "name": "308",
        "prompt": "Peugeot 308, compact car"
      },
      {
        "id": "3008",
        "name": "3008",
        "prompt": "Peugeot 3008, compact SUV"
      },
      {
        "id": "5008",
        "name": "5008",
        "prompt": "Peugeot 5008, mid-size SUV"
      },
      {
        "id": "508",
        "name": "508",
        "prompt": "Peugeot 508, mid-size sedan"
      },
      {
        "id": "2008",
        "name": "2008",
        "prompt": "Peugeot 2008, subcompact SUV"
      }
    ]
  },
  {
    "id": "polestar",
    "name": "Polestar",
    "prompt": "Polestar",
    "models": [
      {
        "id": "2",
        "name": "2",
        "prompt": "Polestar 2, electric fastback"
      },
      {
        "id": "3",
        "name": "3",
        "prompt": "Polestar 3, electric SUV"
      },
      {
        "id": "4",
        "name": "4",
        "prompt": "Polestar 4, electric coupe SUV"
      },
      {
        "id": "5",
        "name": "5",
        "prompt": "Polestar 5, electric grand tourer"
      }
    ]
  },
  {
    "id": "porsche",
    "name": "Porsche",
    "prompt": "Porsche",
    "models": [
      {
        "id": "911",
        "name": "911",
        "prompt": "Porsche 911, iconic sports car"
      },
      {
        "id": "cayenne",
        "name": "Cayenne",
        "prompt": "Porsche Cayenne, luxury SUV"
      },
      {
        "id": "macan",
        "name": "Macan",
        "prompt": "Porsche Macan, compact luxury SUV"
      },
      {
        "id": "taycan",
        "name": "Taycan",
        "prompt": "Porsche Taycan, all-electric sports sedan"
      },
      {
        "id": "panamera",
        "name": "Panamera",
        "prompt": "Porsche Panamera, luxury four-door sports car"
      },
      {
        "id": "cayman",
        "name": "Cayman",
        "prompt": "Porsche Cayman, mid-engine sports car"
      },
      {
        "id": "boxster",
        "name": "Boxster",
        "prompt": "Porsche Boxster, convertible roadster"
      },
      {
        "id": "718",
        "name": "718",
        "prompt": "Porsche 718, entry-level sports car"
      }
    ]
  },
  {
    "id": "proton",
    "name": "Proton",
    "prompt": "Proton",
    "models": [
      {
        "id": "x50",
        "name": "X50",
        "prompt": "Proton X50, compact SUV"
      },
      {
        "id": "x70",
        "name": "X70",
        "prompt": "Proton X70, mid-size SUV"
      },
      {
        "id": "persona",
        "name": "Persona",
        "prompt": "Proton Persona, compact sedan"
      },
      {
        "id": "saga",
        "name": "Saga",
        "prompt": "Proton Saga, budget sedan"
      }
    ]
  },
  {
    "id": "ram",
    "name": "RAM",
    "prompt": "RAM",
    "models": [
      {
        "id": "ram_1500",
        "name": "1500",
        "prompt": "RAM 1500, full-size pickup truck"
      },
      {
        "id": "ram_2500",
        "name": "2500",
        "prompt": "RAM 2500, heavy-duty pickup"
      },
      {
        "id": "ram_3500",
        "name": "3500",
        "prompt": "RAM 3500, heavy-duty dually pickup"
      },
      {
        "id": "ram_trx",
        "name": "TRX",
        "prompt": "RAM 1500 TRX, supercharged off-road pickup"
      },
      {
        "id": "ram_pro",
        "name": "ProMaster",
        "prompt": "RAM ProMaster, cargo van"
      }
    ]
  },
  {
    "id": "renault",
    "name": "Renault",
    "prompt": "Renault",
    "models": [
      {
        "id": "clio",
        "name": "Clio",
        "prompt": "Renault Clio, supermini hatchback"
      },
      {
        "id": "megane",
        "name": "Megane",
        "prompt": "Renault Megane, compact car"
      },
      {
        "id": "captur",
        "name": "Captur",
        "prompt": "Renault Captur, compact crossover"
      },
      {
        "id": "zoe",
        "name": "Zoe",
        "prompt": "Renault Zoe, electric city car"
      },
      {
        "id": "kadjar",
        "name": "Kadjar",
        "prompt": "Renault Kadjar, compact SUV"
      },
      {
        "id": "scenic",
        "name": "Scenic",
        "prompt": "Renault Scenic, compact MPV"
      },
      {
        "id": "arkana",
        "name": "Arkana",
        "prompt": "Renault Arkana, coupe SUV"
      }
    ]
  },
  {
    "id": "rimac",
    "name": "Rimac",
    "prompt": "Rimac",
    "models": [
      {
        "id": "nevera",
        "name": "Nevera",
        "prompt": "Rimac Nevera, all-electric hypercar, 1914 hp"
      },
      {
        "id": "concept_one",
        "name": "Concept One",
        "prompt": "Rimac Concept One, first electric hypercar"
      }
    ]
  },
  {
    "id": "rivian",
    "name": "Rivian",
    "prompt": "Rivian",
    "models": [
      {
        "id": "r1t",
        "name": "R1T",
        "prompt": "Rivian R1T, all-electric pickup truck"
      },
      {
        "id": "r1s",
        "name": "R1S",
        "prompt": "Rivian R1S, all-electric SUV"
      },
      {
        "id": "r2",
        "name": "R2",
        "prompt": "Rivian R2, compact electric SUV"
      }
    ]
  },
  {
    "id": "rolls_royce",
    "name": "Rolls-Royce",
    "prompt": "Rolls-Royce",
    "models": [
      {
        "id": "phantom",
        "name": "Phantom",
        "prompt": "Rolls-Royce Phantom, pinnacle luxury sedan"
      },
      {
        "id": "ghost",
        "name": "Ghost",
        "prompt": "Rolls-Royce Ghost, luxury sedan"
      },
      {
        "id": "cullinan",
        "name": "Cullinan",
        "prompt": "Rolls-Royce Cullinan, luxury SUV"
      },
      {
        "id": "wraith",
        "name": "Wraith",
        "prompt": "Rolls-Royce Wraith, luxury coupe"
      },
      {
        "id": "dawn",
        "name": "Dawn",
        "prompt": "Rolls-Royce Dawn, luxury convertible"
      },
      {
        "id": "spectre",
        "name": "Spectre",
        "prompt": "Rolls-Royce Spectre, all-electric luxury coupe"
      }
    ]
  },
  {
    "id": "seat",
    "name": "SEAT",
    "prompt": "SEAT",
    "models": [
      {
        "id": "leon",
        "name": "Leon",
        "prompt": "SEAT Leon, sporty compact car"
      },
      {
        "id": "ibiza",
        "name": "Ibiza",
        "prompt": "SEAT Ibiza, supermini"
      },
      {
        "id": "arona",
        "name": "Arona",
        "prompt": "SEAT Arona, subcompact SUV"
      },
      {
        "id": "ateca",
        "name": "Ateca",
        "prompt": "SEAT Ateca, compact SUV"
      },
      {
        "id": "tarraco",
        "name": "Tarraco",
        "prompt": "SEAT Tarraco, mid-size SUV"
      }
    ]
  },
  {
    "id": "smart",
    "name": "smart",
    "prompt": "smart",
    "models": [
      {
        "id": "fortwo",
        "name": "Fortwo",
        "prompt": "smart Fortwo, tiny city car"
      },
      {
        "id": "forfour",
        "name": "Forfour",
        "prompt": "smart Forfour, four-seat city car"
      },
      {
        "id": "1",
        "name": "#1",
        "prompt": "smart #1, all-electric compact SUV"
      },
      {
        "id": "3",
        "name": "#3",
        "prompt": "smart #3, electric coupe SUV"
      }
    ]
  },
  {
    "id": "ssangyong",
    "name": "SsangYong",
    "prompt": "SsangYong",
    "models": [
      {
        "id": "korando",
        "name": "Korando",
        "prompt": "SsangYong Korando, compact SUV"
      },
      {
        "id": "tivoli",
        "name": "Tivoli",
        "prompt": "SsangYong Tivoli, subcompact SUV"
      },
      {
        "id": "rexton",
        "name": "Rexton",
        "prompt": "SsangYong Rexton, large SUV"
      },
      {
        "id": "musso",
        "name": "Musso",
        "prompt": "SsangYong Musso, pickup truck"
      },
      {
        "id": "torres",
        "name": "Torres",
        "prompt": "SsangYong Torres, mid-size SUV"
      }
    ]
  },
  {
    "id": "subaru",
    "name": "Subaru",
    "prompt": "Subaru",
    "models": [
      {
        "id": "outback",
        "name": "Outback",
        "prompt": "Subaru Outback, rugged wagon"
      },
      {
        "id": "forester",
        "name": "Forester",
        "prompt": "Subaru Forester, compact SUV"
      },
      {
        "id": "wrx",
        "name": "WRX",
        "prompt": "Subaru WRX, turbocharged sports sedan"
      },
      {
        "id": "legacy",
        "name": "Legacy",
        "prompt": "Subaru Legacy, mid-size sedan"
      },
      {
        "id": "xv",
        "name": "XV Crosstrek",
        "prompt": "Subaru XV Crosstrek, subcompact crossover"
      },
      {
        "id": "brz",
        "name": "BRZ",
        "prompt": "Subaru BRZ, rear-wheel drive sports car"
      },
      {
        "id": "ascent",
        "name": "Ascent",
        "prompt": "Subaru Ascent, mid-size SUV"
      },
      {
        "id": "levorg",
        "name": "Levorg",
        "prompt": "Subaru Levorg, sports wagon"
      }
    ]
  },
  {
    "id": "suzuki",
    "name": "Suzuki",
    "prompt": "Suzuki",
    "models": [
      {
        "id": "jimny",
        "name": "Jimny",
        "prompt": "Suzuki Jimny, small off-road SUV"
      },
      {
        "id": "vitara",
        "name": "Vitara",
        "prompt": "Suzuki Vitara, compact SUV"
      },
      {
        "id": "swift",
        "name": "Swift",
        "prompt": "Suzuki Swift, sporty hatchback"
      },
      {
        "id": "scross",
        "name": "S-Cross",
        "prompt": "Suzuki S-Cross, compact crossover"
      },
      {
        "id": "baleno",
        "name": "Baleno",
        "prompt": "Suzuki Baleno, compact hatchback"
      },
      {
        "id": "ignis",
        "name": "Ignis",
        "prompt": "Suzuki Ignis, city car"
      }
    ]
  },
  {
    "id": "tesla",
    "name": "Tesla",
    "prompt": "Tesla",
    "models": [
      {
        "id": "model_s",
        "name": "Model S",
        "prompt": "Tesla Model S, full-electric luxury sedan"
      },
      {
        "id": "model_3",
        "name": "Model 3",
        "prompt": "Tesla Model 3, compact electric sedan"
      },
      {
        "id": "model_x",
        "name": "Model X",
        "prompt": "Tesla Model X, electric SUV with falcon doors"
      },
      {
        "id": "model_y",
        "name": "Model Y",
        "prompt": "Tesla Model Y, compact electric SUV"
      },
      {
        "id": "cybertruck",
        "name": "Cybertruck",
        "prompt": "Tesla Cybertruck, futuristic electric pickup"
      },
      {
        "id": "roadster",
        "name": "Roadster",
        "prompt": "Tesla Roadster, all-electric sports car"
      }
    ]
  },
  {
    "id": "toyota",
    "name": "🚗 Toyota",
    "prompt": "Toyota",
    "models": [
      {
        "id": "camry",
        "name": "Camry",
        "prompt": "Toyota Camry, mid-size sedan, elegant and reliable"
      },
      {
        "id": "corolla",
        "name": "Corolla",
        "prompt": "Toyota Corolla, compact sedan, world's best-selling car"
      },
      {
        "id": "rav4",
        "name": "RAV4",
        "prompt": "Toyota RAV4, popular compact SUV, rugged and versatile"
      },
      {
        "id": "land_cruiser",
        "name": "Land Cruiser",
        "prompt": "Toyota Land Cruiser, legendary off-road SUV"
      },
      {
        "id": "hilux",
        "name": "Hilux",
        "prompt": "Toyota Hilux, indestructible pickup truck"
      },
      {
        "id": "supra",
        "name": "Supra",
        "prompt": "Toyota Supra, iconic Japanese sports car"
      },
      {
        "id": "prius",
        "name": "Prius",
        "prompt": "Toyota Prius, pioneering hybrid car"
      },
      {
        "id": "yaris",
        "name": "Yaris",
        "prompt": "Toyota Yaris, compact hatchback"
      },
      {
        "id": "highlander",
        "name": "Highlander",
        "prompt": "Toyota Highlander, family SUV"
      },
      {
        "id": "tacoma",
        "name": "Tacoma",
        "prompt": "Toyota Tacoma, mid-size pickup truck"
      }
    ]
  },
  {
    "id": "trabant",
    "name": "Trabant",
    "prompt": "Trabant",
    "models": [
      {
        "id": "601",
        "name": "601",
        "prompt": "Trabant 601, iconic East German car"
      },
      {
        "id": "p50",
        "name": "P50",
        "prompt": "Trabant P50, early Trabant"
      }
    ]
  },
  {
    "id": "volkswagen",
    "name": "Volkswagen",
    "prompt": "Volkswagen",
    "models": [
      {
        "id": "golf",
        "name": "Golf",
        "prompt": "Volkswagen Golf, iconic hatchback"
      },
      {
        "id": "passat",
        "name": "Passat",
        "prompt": "Volkswagen Passat, mid-size sedan"
      },
      {
        "id": "tiguan",
        "name": "Tiguan",
        "prompt": "Volkswagen Tiguan, compact SUV"
      },
      {
        "id": "polo",
        "name": "Polo",
        "prompt": "Volkswagen Polo, supermini hatchback"
      },
      {
        "id": "touareg",
        "name": "Touareg",
        "prompt": "Volkswagen Touareg, luxury SUV"
      },
      {
        "id": "id4",
        "name": "ID.4",
        "prompt": "Volkswagen ID.4, all-electric compact SUV"
      },
      {
        "id": "arteon",
        "name": "Arteon",
        "prompt": "Volkswagen Arteon, four-door coupe"
      },
      {
        "id": "jetta",
        "name": "Jetta",
        "prompt": "Volkswagen Jetta, compact sedan"
      },
      {
        "id": "beetle",
        "name": "Beetle",
        "prompt": "Volkswagen Beetle, classic retro car"
      },
      {
        "id": "transporter",
        "name": "Transporter",
        "prompt": "Volkswagen Transporter, iconic van"
      }
    ]
  },
  {
    "id": "volvo",
    "name": "Volvo",
    "prompt": "Volvo",
    "models": [
      {
        "id": "xc90",
        "name": "XC90",
        "prompt": "Volvo XC90, luxury mid-size SUV"
      },
      {
        "id": "xc60",
        "name": "XC60",
        "prompt": "Volvo XC60, compact luxury SUV"
      },
      {
        "id": "xc40",
        "name": "XC40",
        "prompt": "Volvo XC40, subcompact luxury SUV"
      },
      {
        "id": "s60",
        "name": "S60",
        "prompt": "Volvo S60, compact luxury sedan"
      },
      {
        "id": "s90",
        "name": "S90",
        "prompt": "Volvo S90, flagship luxury sedan"
      },
      {
        "id": "v60",
        "name": "V60",
        "prompt": "Volvo V60, luxury wagon"
      },
      {
        "id": "v90",
        "name": "V90",
        "prompt": "Volvo V90, flagship luxury wagon"
      },
      {
        "id": "c40",
        "name": "C40",
        "prompt": "Volvo C40, electric coupe SUV"
      },
      {
        "id": "ex90",
        "name": "EX90",
        "prompt": "Volvo EX90, all-electric flagship SUV"
      }
    ]
  },
  {
    "id": "wartburg",
    "name": "Wartburg",
    "prompt": "Wartburg",
    "models": [
      {
        "id": "353",
        "name": "353",
        "prompt": "Wartburg 353, East German sedan"
      },
      {
        "id": "1_3",
        "name": "1.3",
        "prompt": "Wartburg 1.3, updated East German car"
      }
    ]
  },
  {
    "id": "xpeng",
    "name": "XPeng",
    "prompt": "XPeng",
    "models": [
      {
        "id": "p7",
        "name": "P7",
        "prompt": "XPeng P7, electric sports sedan"
      },
      {
        "id": "g6",
        "name": "G6",
        "prompt": "XPeng G6, electric SUV"
      },
      {
        "id": "g9",
        "name": "G9",
        "prompt": "XPeng G9, large electric SUV"
      },
      {
        "id": "p5",
        "name": "P5",
        "prompt": "XPeng P5, compact electric sedan"
      }
    ]
  },
  {
    "id": "yamaha_moto",
    "name": "Yamaha Motor",
    "prompt": "Yamaha",
    "models": [
      {
        "id": "r1",
        "name": "R1",
        "prompt": "Yamaha YZF-R1, liter-class superbike"
      },
      {
        "id": "mt09",
        "name": "MT-09",
        "prompt": "Yamaha MT-09, hyper naked"
      },
      {
        "id": "tenere",
        "name": "Tenere 700",
        "prompt": "Yamaha Tenere 700, adventure motorcycle"
      }
    ]
  },
  {
    "id": "gaz",
    "name": "ГАЗ",
    "prompt": "GAZ",
    "models": [
      {
        "id": "gazelle",
        "name": "Газель",
        "prompt": "ГАЗ Газель, популярный российский фургон"
      },
      {
        "id": "chaika",
        "name": "Чайка",
        "prompt": "ГАЗ Чайка, советский представительский автомобиль"
      },
      {
        "id": "volga",
        "name": "Волга",
        "prompt": "ГАЗ Волга, классический советский автомобиль"
      },
      {
        "id": "pobeda",
        "name": "Победа",
        "prompt": "ГАЗ Победа, легендарный советский автомобиль"
      },
      {
        "id": "m21",
        "name": "М-21",
        "prompt": "ГАЗ М-21 Волга, культовая советская машина"
      }
    ]
  },
  {
    "id": "zaz",
    "name": "ЗАЗ",
    "prompt": "ZAZ",
    "models": [
      {
        "id": "zaporozhets",
        "name": "Запорожец",
        "prompt": "ЗАЗ Запорожец, советский заднемоторный автомобиль"
      },
      {
        "id": "tavria",
        "name": "Таврия",
        "prompt": "ЗАЗ Таврия, советский переднеприводный автомобиль"
      },
      {
        "id": "sensation",
        "name": "Sens",
        "prompt": "ЗАЗ Sens, украинский автомобиль"
      }
    ]
  },
  {
    "id": "izh",
    "name": "ИЖ",
    "prompt": "IZH",
    "models": [
      {
        "id": "2125",
        "name": "ИЖ-2125 Комби",
        "prompt": "ИЖ-2125 Комби, советский хетчбэк"
      },
      {
        "id": "2715",
        "name": "ИЖ-2715",
        "prompt": "ИЖ-2715, советский грузовой автомобиль"
      },
      {
        "id": "moskvich_412_izh",
        "name": "ИЖ-412",
        "prompt": "ИЖ-412, москвич производства Ижевска"
      }
    ]
  },
  {
    "id": "moskvich",
    "name": "Москвич",
    "prompt": "Moskvich",
    "models": [
      {
        "id": "412",
        "name": "Москвич-412",
        "prompt": "Москвич-412, классический советский седан"
      },
      {
        "id": "2141",
        "name": "Москвич-2141",
        "prompt": "Москвич-2141, советский хетчбэк"
      },
      {
        "id": "3e",
        "name": "Москвич 3e",
        "prompt": "Москвич 3e, современный электромобиль"
      },
      {
        "id": "408",
        "name": "Москвич-408",
        "prompt": "Москвич-408, легендарный советский автомобиль"
      }
    ]
  },
  {
    "id": "uaz",
    "name": "УАЗ",
    "prompt": "UAZ",
    "models": [
      {
        "id": "patriot",
        "name": "Патриот",
        "prompt": "УАЗ Патриот, российский внедорожник"
      },
      {
        "id": "buhanka",
        "name": "Буханка",
        "prompt": "УАЗ Буханка, легендарный советский фургон"
      },
      {
        "id": "loaf",
        "name": "Хантер",
        "prompt": "УАЗ Хантер, классический внедорожник"
      },
      {
        "id": "pickup",
        "name": "Пикап",
        "prompt": "УАЗ Пикап, грузовой внедорожник"
      },
      {
        "id": "profitable",
        "name": "Профи",
        "prompt": "УАЗ Профи, малотоннажный грузовик"
      }
    ]
  }
];

module.exports = { CAR_BRANDS };
