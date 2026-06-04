// Seed the Chinook demo dataset + create demo users
// Run: pnpm db:seed
import 'dotenv/config'

import { db } from '../src/db/index.js'

console.log('Seeding demo data...')

db.transaction(() => {
  // ── Demo users ──
  const insertUser = db.prepare('INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)')
  insertUser.run('demo-user-1', 'alice')
  insertUser.run('demo-user-2', 'bob')
  insertUser.run('demo-user-3', 'charlie')

  // ── Genres ──
  const insertGenre = db.prepare('INSERT OR IGNORE INTO genres (genre_id, name) VALUES (?, ?)')
  const genres = [
    'Rock',
    'Jazz',
    'Metal',
    'Alternative & Punk',
    'Classical',
    'Blues',
    'Pop',
    'R&B/Soul',
    'Electronic',
    'Reggae',
    'Hip Hop/Rap',
    'Latin',
  ]
  genres.forEach((g, i) => insertGenre.run(i + 1, g))

  // ── Media Types ──
  const insertMedia = db.prepare('INSERT OR IGNORE INTO media_types (media_type_id, name) VALUES (?, ?)')
  ;['MPEG audio file', 'Protected AAC audio file', 'AAC audio file'].forEach((m, i) => insertMedia.run(i + 1, m))

  // ── Artists ──
  const insertArtist = db.prepare('INSERT OR IGNORE INTO artists (artist_id, name) VALUES (?, ?)')
  const artists = [
    'AC/DC',
    'Aerosmith',
    'Alanis Morissette',
    'Alice In Chains',
    'Apocalyptica',
    'Audioslave',
    'The Beatles',
    'Billy Cobham',
    'Black Sabbath',
    'Miles Davis',
    'Deep Purple',
    'Def Leppard',
    'Eric Clapton',
    'Foo Fighters',
    'Frank Sinatra',
    'Iron Maiden',
    'Jamiroquai',
    'Led Zeppelin',
    'Metallica',
    'Nirvana',
    'Pearl Jam',
    'Pink Floyd',
    'Queen',
    'Red Hot Chili Peppers',
    'U2',
  ]
  artists.forEach((a, i) => insertArtist.run(i + 1, a))

  // ── Albums ──
  const insertAlbum = db.prepare('INSERT OR IGNORE INTO albums (album_id, title, artist_id) VALUES (?, ?, ?)')
  const albums: [number, string, number][] = [
    [1, 'For Those About To Rock We Salute You', 1],
    [2, 'Let There Be Rock', 1],
    [3, 'Get Your Wings', 2],
    [4, 'Jagged Little Pill', 3],
    [5, 'Facelift', 4],
    [6, 'Plays Metallica By Four Cellos', 5],
    [7, 'Audioslave', 6],
    [8, 'Abbey Road', 7],
    [9, 'Let It Be', 7],
    [10, 'Spectrum', 8],
    [11, 'Paranoid', 9],
    [12, 'Kind of Blue', 10],
    [13, 'Machine Head', 11],
    [14, 'Hysteria', 12],
    [15, 'Unplugged', 13],
    [16, 'Wasting Light', 14],
    [17, 'Come Fly With Me', 15],
    [18, 'The Number of the Beast', 16],
    [19, 'Powerslave', 16],
    [20, 'Travelling Without Moving', 17],
    [21, 'Led Zeppelin IV', 18],
    [22, 'Master of Puppets', 19],
    [23, 'Ride the Lightning', 19],
    [24, 'Nevermind', 20],
    [25, 'In Utero', 20],
    [26, 'Ten', 21],
    [27, 'The Dark Side of the Moon', 22],
    [28, 'Wish You Were Here', 22],
    [29, 'A Night at the Opera', 23],
    [30, 'News of the World', 23],
    [31, 'Californication', 24],
    [32, 'Blood Sugar Sex Magik', 24],
    [33, 'The Joshua Tree', 25],
    [34, 'Achtung Baby', 25],
  ]
  albums.forEach(([id, title, artistId]) => insertAlbum.run(id, title, artistId))

  // ── Tracks ──
  const insertTrack = db.prepare(
    'INSERT OR IGNORE INTO tracks (track_id, name, album_id, media_type_id, genre_id, composer, milliseconds, bytes, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  let trackId = 1
  const trackData: [string, number, number, string | null, number][] = [
    // AC/DC - For Those About To Rock
    ['For Those About To Rock (We Salute You)', 1, 1, 'Angus Young, Malcolm Young, Brian Johnson', 343719],
    ['Put The Finger On You', 1, 1, 'Angus Young, Malcolm Young, Brian Johnson', 205662],
    ['Inject The Venom', 1, 1, 'Angus Young, Malcolm Young, Brian Johnson', 210834],
    ['Evil Walks', 1, 1, 'Angus Young, Malcolm Young, Brian Johnson', 263497],
    ['Breaking The Rules', 1, 1, 'Angus Young, Malcolm Young, Brian Johnson', 263288],
    // AC/DC - Let There Be Rock
    ['Go Down', 2, 1, 'AC/DC', 331180],
    ['Dog Eat Dog', 2, 1, 'AC/DC', 215196],
    ['Whole Lotta Rosie', 2, 1, 'AC/DC', 323761],
    // Aerosmith
    ['Same Old Song And Dance', 3, 1, 'Steven Tyler, Joe Perry', 199680],
    ["Pandora's Box", 3, 1, 'Steven Tyler, Joe Perry', 218636],
    // Alanis Morissette
    ['You Oughta Know', 4, 4, 'Alanis Morissette', 249234],
    ['Ironic', 4, 4, 'Alanis Morissette', 229840],
    ['Hand In My Pocket', 4, 4, 'Alanis Morissette', 221570],
    // Alice In Chains
    ['We Die Young', 5, 3, 'Jerry Cantrell', 152084],
    ['Man In The Box', 5, 3, 'Jerry Cantrell', 286641],
    // Apocalyptica
    ['Enter Sandman', 6, 3, 'Apocalyptica', 221701],
    ['Master Of Puppets', 6, 3, 'Apocalyptica', 436453],
    // Audioslave
    ['Cochise', 7, 1, 'Audioslave', 222380],
    ['Show Me How To Live', 7, 1, 'Audioslave', 277890],
    ['Like A Stone', 7, 1, 'Audioslave', 294034],
    // The Beatles
    ['Come Together', 8, 1, 'Lennon, McCartney', 259947],
    ['Something', 8, 1, 'Harrison', 182988],
    ['Here Comes The Sun', 8, 1, 'Harrison', 185338],
    ['Let It Be', 9, 1, 'Lennon, McCartney', 243027],
    ['Get Back', 9, 1, 'Lennon, McCartney', 190781],
    // Billy Cobham
    ['Quadrant', 10, 2, 'Billy Cobham', 261851],
    ["Snoopy's Search (Red Baron)", 10, 2, 'Billy Cobham', 456071],
    // Black Sabbath
    ['War Pigs', 11, 3, 'Black Sabbath', 475693],
    ['Paranoid', 11, 3, 'Black Sabbath', 170734],
    ['Iron Man', 11, 3, 'Black Sabbath', 355867],
    // Miles Davis
    ['So What', 12, 2, 'Miles Davis', 545338],
    ['Freddie Freeloader', 12, 2, 'Miles Davis', 580138],
    ['Blue In Green', 12, 2, 'Miles Davis', 327219],
    // Deep Purple
    ['Smoke On The Water', 13, 1, 'Ritchie Blackmore', 339853],
    ['Highway Star', 13, 1, 'Ritchie Blackmore', 367828],
    // Def Leppard
    ['Pour Some Sugar On Me', 14, 1, 'Def Leppard', 264773],
    ['Hysteria', 14, 1, 'Def Leppard', 355800],
    // Eric Clapton
    ['Layla', 15, 6, 'Eric Clapton', 478349],
    ['Tears In Heaven', 15, 6, 'Eric Clapton', 274482],
    // Foo Fighters
    ['Bridge Burning', 16, 1, 'Dave Grohl', 285697],
    ['Rope', 16, 1, 'Dave Grohl', 262253],
    ['Walk', 16, 1, 'Dave Grohl', 302826],
    // Frank Sinatra
    ['Come Fly With Me', 17, 7, 'Sammy Cahn', 190604],
    ['Fly Me To The Moon', 17, 7, null, 149263],
    // Iron Maiden
    ['The Number Of The Beast', 18, 3, 'Steve Harris', 294142],
    ['Run To The Hills', 18, 3, 'Steve Harris', 229459],
    ['Aces High', 19, 3, 'Steve Harris', 269531],
    ['2 Minutes To Midnight', 19, 3, 'Adrian Smith, Bruce Dickinson', 359810],
    // Jamiroquai
    ['Virtual Insanity', 20, 9, 'Jay Kay', 323310],
    ['Cosmic Girl', 20, 9, 'Jay Kay', 291810],
    // Led Zeppelin
    ['Stairway To Heaven', 21, 1, 'Jimmy Page, Robert Plant', 482130],
    ['Black Dog', 21, 1, 'Jimmy Page, Robert Plant, John Paul Jones', 296464],
    ['Rock And Roll', 21, 1, 'Jimmy Page, Robert Plant, John Paul Jones, John Bonham', 220917],
    // Metallica
    ['Master Of Puppets', 22, 3, 'James Hetfield, Lars Ulrich, Kirk Hammett, Cliff Burton', 515539],
    ['Battery', 22, 3, 'James Hetfield, Lars Ulrich', 312325],
    ['Welcome Home (Sanitarium)', 22, 3, 'James Hetfield, Lars Ulrich, Kirk Hammett', 387186],
    ['Fade To Black', 23, 3, 'James Hetfield, Lars Ulrich, Kirk Hammett, Cliff Burton', 414824],
    ['Creeping Death', 23, 3, 'James Hetfield, Lars Ulrich, Kirk Hammett, Cliff Burton', 396878],
    // Nirvana
    ['Smells Like Teen Spirit', 24, 4, 'Kurt Cobain', 301888],
    ['Come As You Are', 24, 4, 'Kurt Cobain', 219219],
    ['Lithium', 24, 4, 'Kurt Cobain', 256992],
    ['Heart-Shaped Box', 25, 4, 'Kurt Cobain', 281056],
    ['All Apologies', 25, 4, 'Kurt Cobain', 228172],
    // Pearl Jam
    ['Alive', 26, 1, 'Eddie Vedder, Stone Gossard', 341163],
    ['Even Flow', 26, 1, 'Eddie Vedder, Stone Gossard', 293720],
    ['Jeremy', 26, 1, 'Eddie Vedder, Jeff Ament', 318981],
    // Pink Floyd
    ['Speak To Me / Breathe', 27, 1, 'Roger Waters', 234213],
    ['Time', 27, 1, 'Roger Waters, David Gilmour, Nick Mason, Richard Wright', 413947],
    ['Money', 27, 1, 'Roger Waters', 382305],
    ['Wish You Were Here', 28, 1, 'Roger Waters, David Gilmour', 334743],
    ['Shine On You Crazy Diamond (Parts I-V)', 28, 1, 'Roger Waters, David Gilmour, Richard Wright', 810554],
    // Queen
    ['Bohemian Rhapsody', 29, 1, 'Freddie Mercury', 354947],
    ["You're My Best Friend", 29, 1, 'John Deacon', 170458],
    ['Love Of My Life', 29, 1, 'Freddie Mercury', 216465],
    ['We Will Rock You', 30, 1, 'Brian May', 122671],
    ['We Are The Champions', 30, 1, 'Freddie Mercury', 181733],
    // Red Hot Chili Peppers
    ['Californication', 31, 4, 'Red Hot Chili Peppers', 321671],
    ['Scar Tissue', 31, 4, 'Red Hot Chili Peppers', 215680],
    ['Otherside', 31, 4, 'Red Hot Chili Peppers', 255973],
    ['Give It Away', 32, 4, 'Red Hot Chili Peppers', 283720],
    ['Under The Bridge', 32, 4, 'Red Hot Chili Peppers', 264359],
    // U2
    ['Where The Streets Have No Name', 33, 1, 'U2', 338813],
    ['With Or Without You', 33, 1, 'U2', 296840],
    ["I Still Haven't Found What I'm Looking For", 33, 1, 'U2', 281520],
    ['One', 34, 1, 'U2', 276013],
    ['Mysterious Ways', 34, 1, 'U2', 239080],
  ]
  for (const [name, albumId, genreId, composer, ms] of trackData) {
    insertTrack.run(trackId, name, albumId, 1, genreId, composer, ms, Math.floor(ms * 40), 0.99)
    trackId++
  }

  // ── Employees ──
  const insertEmployee = db.prepare(
    'INSERT OR IGNORE INTO employees (employee_id, last_name, first_name, title, reports_to, hire_date, email, city, state, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  insertEmployee.run(
    1,
    'Adams',
    'Andrew',
    'General Manager',
    null,
    '2002-08-14',
    'andrew@chinookcorp.com',
    'Edmonton',
    'AB',
    'Canada',
  )
  insertEmployee.run(
    2,
    'Edwards',
    'Nancy',
    'Sales Manager',
    1,
    '2002-05-01',
    'nancy@chinookcorp.com',
    'Calgary',
    'AB',
    'Canada',
  )
  insertEmployee.run(
    3,
    'Peacock',
    'Jane',
    'Sales Support Agent',
    2,
    '2002-04-01',
    'jane@chinookcorp.com',
    'Calgary',
    'AB',
    'Canada',
  )
  insertEmployee.run(
    4,
    'Park',
    'Margaret',
    'Sales Support Agent',
    2,
    '2003-05-03',
    'margaret@chinookcorp.com',
    'Calgary',
    'AB',
    'Canada',
  )
  insertEmployee.run(
    5,
    'Johnson',
    'Steve',
    'Sales Support Agent',
    2,
    '2003-10-17',
    'steve@chinookcorp.com',
    'Calgary',
    'AB',
    'Canada',
  )

  // ── Customers ──
  const insertCustomer = db.prepare(
    'INSERT OR IGNORE INTO customers (customer_id, first_name, last_name, email, company, city, state, country, support_rep_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const customers: [number, string, string, string, string | null, string, string | null, string, number][] = [
    [1, 'Luís', 'Gonçalves', 'luisg@embraer.com.br', 'Embraer', 'São José dos Campos', 'SP', 'Brazil', 3],
    [2, 'Leonie', 'Köhler', 'leonekohler@surfeu.de', null, 'Stuttgart', null, 'Germany', 5],
    [3, 'François', 'Tremblay', 'ftremblay@gmail.com', null, 'Montréal', 'QC', 'Canada', 3],
    [4, 'Bjørn', 'Hansen', 'bjorn.hansen@yahoo.no', null, 'Oslo', null, 'Norway', 4],
    [5, 'František', 'Wichterlová', 'frantisekw@jetbrains.com', 'JetBrains', 'Prague', null, 'Czech Republic', 4],
    [6, 'Helena', 'Holý', 'hholy@gmail.com', null, 'Prague', null, 'Czech Republic', 5],
    [7, 'Astrid', 'Gruber', 'astrid.gruber@apple.at', 'Apple', 'Vienna', null, 'Austria', 5],
    [8, 'Daan', 'Peeters', 'daan_peeters@apple.be', 'Apple', 'Brussels', null, 'Belgium', 4],
    [9, 'Kara', 'Nielsen', 'kara.nielsen@jubii.dk', null, 'Copenhagen', null, 'Denmark', 4],
    [10, 'Eduardo', 'Martins', 'eduardo@woodstock.com.br', 'Woodstock', 'São Paulo', 'SP', 'Brazil', 4],
    [11, 'Alexandre', 'Rocha', 'alero@uol.com.br', null, 'São Paulo', 'SP', 'Brazil', 5],
    [12, 'Roberto', 'Almeida', 'roberto.almeida@riotur.gov.br', 'Riotur', 'Rio de Janeiro', 'RJ', 'Brazil', 3],
    [13, 'Fernanda', 'Ramos', 'ferlam@uol.com.br', null, 'Brasília', 'DF', 'Brazil', 4],
    [14, 'Mark', 'Philips', 'mphilips12@shaw.ca', 'Telus', 'Edmonton', 'AB', 'Canada', 5],
    [15, 'Jennifer', 'Peterson', 'jenniferp@rogers.ca', 'Rogers', 'Vancouver', 'BC', 'Canada', 3],
  ]
  customers.forEach((c) => insertCustomer.run(...c))

  // ── Invoices ──
  const insertInvoice = db.prepare(
    'INSERT OR IGNORE INTO invoices (invoice_id, customer_id, invoice_date, billing_city, billing_country, total) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const invoices: [number, number, string, string, string, number][] = [
    [1, 2, '2024-01-01', 'Stuttgart', 'Germany', 1.98],
    [2, 4, '2024-01-02', 'Oslo', 'Norway', 3.96],
    [3, 8, '2024-01-03', 'Brussels', 'Belgium', 5.94],
    [4, 14, '2024-01-06', 'Edmonton', 'Canada', 8.91],
    [5, 1, '2024-01-11', 'São José dos Campos', 'Brazil', 13.86],
    [6, 13, '2024-02-01', 'Brasília', 'Brazil', 0.99],
    [7, 15, '2024-02-01', 'Vancouver', 'Canada', 1.98],
    [8, 3, '2024-02-02', 'Montréal', 'Canada', 3.96],
    [9, 7, '2024-02-03', 'Vienna', 'Austria', 5.94],
    [10, 12, '2024-02-06', 'Rio de Janeiro', 'Brazil', 8.91],
    [11, 5, '2024-02-11', 'Prague', 'Czech Republic', 1.98],
    [12, 10, '2024-03-01', 'São Paulo', 'Brazil', 1.98],
    [13, 11, '2024-03-02', 'São Paulo', 'Brazil', 3.96],
    [14, 6, '2024-03-05', 'Prague', 'Czech Republic', 5.94],
    [15, 9, '2024-03-08', 'Copenhagen', 'Denmark', 8.91],
    [16, 1, '2024-03-11', 'São José dos Campos', 'Brazil', 0.99],
    [17, 2, '2024-04-01', 'Stuttgart', 'Germany', 3.96],
    [18, 4, '2024-04-05', 'Oslo', 'Norway', 5.94],
    [19, 8, '2024-04-09', 'Brussels', 'Belgium', 1.98],
    [20, 14, '2024-05-01', 'Edmonton', 'Canada', 13.86],
    [21, 3, '2024-05-15', 'Montréal', 'Canada', 8.91],
    [22, 15, '2024-06-01', 'Vancouver', 'Canada', 1.98],
    [23, 7, '2024-06-15', 'Vienna', 'Austria', 3.96],
    [24, 5, '2024-07-01', 'Prague', 'Czech Republic', 5.94],
    [25, 9, '2024-07-15', 'Copenhagen', 'Denmark', 0.99],
  ]
  invoices.forEach((inv) => insertInvoice.run(...inv))

  // ── Invoice Items ──
  const insertItem = db.prepare(
    'INSERT OR IGNORE INTO invoice_items (invoice_line_id, invoice_id, track_id, unit_price, quantity) VALUES (?, ?, ?, ?, ?)',
  )
  let lineId = 1
  const itemData: [number, number, number][] = [
    [1, 2, 2],
    [1, 4, 4],
    [2, 1, 4],
    [2, 5, 4],
    [3, 8, 6],
    [3, 10, 6],
    [4, 11, 9],
    [4, 14, 9],
    [4, 18, 9],
    [5, 21, 14],
    [5, 28, 14],
    [5, 31, 14],
    [6, 43, 1],
    [7, 45, 2],
    [7, 46, 2],
    [8, 50, 4],
    [8, 53, 4],
    [8, 55, 4],
    [9, 58, 6],
    [9, 60, 6],
    [9, 63, 6],
    [10, 65, 9],
    [10, 68, 9],
    [10, 71, 9],
    [11, 73, 2],
    [11, 75, 2],
    [12, 34, 2],
    [12, 37, 2],
    [13, 38, 4],
    [13, 40, 4],
    [14, 42, 6],
    [14, 44, 6],
    [14, 47, 6],
    [15, 49, 9],
    [15, 51, 9],
    [15, 52, 9],
    [16, 1, 1],
    [17, 6, 4],
    [17, 7, 4],
    [17, 9, 4],
    [18, 15, 6],
    [18, 16, 6],
    [18, 17, 6],
    [19, 20, 2],
    [19, 22, 2],
    [20, 23, 14],
    [20, 25, 14],
    [20, 26, 14],
    [21, 30, 9],
    [21, 32, 9],
    [21, 33, 9],
    [22, 35, 2],
    [22, 36, 2],
    [23, 56, 4],
    [23, 57, 4],
    [24, 61, 6],
    [24, 62, 6],
    [24, 64, 6],
    [25, 48, 1],
  ]
  for (const [invoiceId, trackIdRef, quantity] of itemData) {
    insertItem.run(lineId, invoiceId, trackIdRef, 0.99, quantity)
    lineId++
  }

  // ── Playlists ──
  const insertPlaylist = db.prepare('INSERT OR IGNORE INTO playlists (playlist_id, name) VALUES (?, ?)')
  const playlists = ['Classic Rock', 'Jazz Essentials', 'Heavy Metal', 'Grunge & Alternative', '90s Music']
  playlists.forEach((p, i) => insertPlaylist.run(i + 1, p))

  const insertPlaylistTrack = db.prepare('INSERT OR IGNORE INTO playlist_track (playlist_id, track_id) VALUES (?, ?)')
  // Classic Rock
  ;[1, 2, 6, 21, 22, 34, 35, 50, 51, 63, 64, 71, 72, 80, 81, 82, 83].forEach((t) => insertPlaylistTrack.run(1, t))
  // Jazz Essentials
  ;[26, 27, 31, 32, 33, 43, 44].forEach((t) => insertPlaylistTrack.run(2, t))
  // Heavy Metal
  ;[14, 15, 16, 17, 28, 29, 30, 45, 46, 47, 48, 53, 54, 55, 56, 57].forEach((t) => insertPlaylistTrack.run(3, t))
  // Grunge & Alternative
  ;[11, 12, 13, 58, 59, 60, 61, 62, 63, 64, 65, 76, 77, 78].forEach((t) => insertPlaylistTrack.run(4, t))
  // 90s Music
  ;[11, 12, 13, 58, 59, 60, 49, 50, 76, 77].forEach((t) => insertPlaylistTrack.run(5, t))
})()

const stats = {
  artists: (db.prepare('SELECT COUNT(*) as c FROM artists').get() as { c: number }).c,
  albums: (db.prepare('SELECT COUNT(*) as c FROM albums').get() as { c: number }).c,
  tracks: (db.prepare('SELECT COUNT(*) as c FROM tracks').get() as { c: number }).c,
  genres: (db.prepare('SELECT COUNT(*) as c FROM genres').get() as { c: number }).c,
  customers: (db.prepare('SELECT COUNT(*) as c FROM customers').get() as { c: number }).c,
  employees: (db.prepare('SELECT COUNT(*) as c FROM employees').get() as { c: number }).c,
  invoices: (db.prepare('SELECT COUNT(*) as c FROM invoices').get() as { c: number }).c,
  users: (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c,
}

console.log('Seed complete:')
console.log(`  ${stats.artists} artists, ${stats.albums} albums, ${stats.tracks} tracks, ${stats.genres} genres`)
console.log(`  ${stats.customers} customers, ${stats.employees} employees, ${stats.invoices} invoices`)
console.log(`  ${stats.users} demo users`)
