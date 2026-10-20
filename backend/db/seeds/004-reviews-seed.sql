-- These rows are fake - but i intend to replace these with real scraped data later on

-- Product 1: Timberland 6" Premium Waterproof Boots (7 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (1, 5.0, 'zappos', 'seed-zappos-p01-r01', 'Exactly what I wanted', 'I have been wearing the Timberland 6" Premium Waterproof Boots regularly and they handled wet weather well. So far they have been a reliable pair for regular use.', '2025-05-07'),
    (1, 4.0, 'nordstrom', 'seed-nordstrom-p01-r02', 'Solid choice', 'These have been good overall: they handled wet weather well, although the leather showed creasing quickly. That was not a deal breaker for me, but it is worth keeping in mind.', '2025-04-26'),
    (1, 5.0, 'amazon', 'seed-amazon-p01-r03', 'Very comfortable', 'The Timberland 6" Premium Waterproof Boots worked out really well for me; they became very comfortable after a short break-in. They have become one of the pairs I reach for most often.', '2025-05-03'),
    (1, 5.0, 'brand_site', 'seed-brand_site-p01-r04', 'Very comfortable', 'The Timberland 6" Premium Waterproof Boots worked out really well for me; the sole has good traction. So far they have been a reliable pair for regular use.', '2026-04-18'),
    (1, 3.0, 'zappos', 'seed-zappos-p01-r05', 'Fit was the main issue', 'The Timberland 6" Premium Waterproof Boots are okay overall. The ankle support feels solid, but the fit ran a little large. I will keep using them, but I expected a little more.', '2025-12-10'),
    (1, 5.0, 'nordstrom', 'seed-nordstrom-p01-r06', 'Exactly what I wanted', 'I have been wearing the Timberland 6" Premium Waterproof Boots regularly and they handled wet weather well. So far they have been a reliable pair for regular use.', '2026-09-22'),
    (1, 5.0, 'amazon', 'seed-amazon-p01-r07', 'Great everyday option', 'I have been wearing the Timberland 6" Premium Waterproof Boots regularly and the leather feels sturdy and well finished. So far they have been a reliable pair for regular use.', '2025-03-28');

-- Product 2: Nike Air Force 1 Low (8 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (2, 5.0, 'foot_locker', 'seed-foot_locker-p02-r01', 'Exactly what I wanted', 'After a few weeks with these, they were easy to style with different outfits. Sizing was close to what I expected and I would buy them again.', '2026-08-24'),
    (2, 5.0, 'zappos', 'seed-zappos-p02-r02', 'Excellent pair', 'I have been wearing the Nike Air Force 1 Low regularly and the cushioning is good for walking around all day. So far they have been a reliable pair for regular use.', '2026-02-14'),
    (2, 5.0, 'brand_site', 'seed-brand_site-p02-r03', 'Very comfortable', 'The Nike Air Force 1 Low worked out really well for me; they were easy to style with different outfits. So far they have been a reliable pair for regular use.', '2025-07-23'),
    (2, 4.0, 'amazon', 'seed-amazon-p02-r04', 'Very good overall', 'Overall I like the Nike Air Force 1 Low. They are comfortable for everyday wear, but they crease pretty quickly. That was not a deal breaker for me, but it is worth keeping in mind.', '2025-05-06'),
    (2, 5.0, 'foot_locker', 'seed-foot_locker-p02-r05', 'Would buy again', 'After a few weeks with these, the cushioning is good for walking around all day. They have become one of the pairs I reach for most often.', '2026-07-10'),
    (2, 3.0, 'zappos', 'seed-zappos-p02-r06', 'Fit was the main issue', 'I have mixed feelings about these. The materials feel solid, while they crease pretty quickly. I will keep using them, but I expected a little more.', '2026-06-03'),
    (2, 5.0, 'brand_site', 'seed-brand_site-p02-r07', 'Exactly what I wanted', 'The Nike Air Force 1 Low worked out really well for me; the materials feel solid. So far they have been a reliable pair for regular use.', '2025-10-01'),
    (2, 5.0, 'amazon', 'seed-amazon-p02-r08', 'Great everyday option', 'I have been wearing the Nike Air Force 1 Low regularly and they are comfortable for everyday wear. So far they have been a reliable pair for regular use.', '2025-10-18');

-- Product 3: Crocs Classic Clogs (9 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (3, 5.0, 'brand_site', 'seed-brand_site-p03-r01', 'Great everyday option', 'After a few weeks with these, the straps stay secure without rubbing. Sizing was close to what I expected and I would buy them again.', '2025-06-21'),
    (3, 5.0, 'zappos', 'seed-zappos-p03-r02', 'Exactly what I wanted', 'I have been wearing the Crocs Classic Clogs regularly and the sole has better support than most sandals. Sizing was close to what I expected and I would buy them again.', '2025-06-04'),
    (3, 5.0, 'rei', 'seed-rei-p03-r03', 'Exactly what I wanted', 'The Crocs Classic Clogs worked out really well for me; the footbed is comfortable for long walks. So far they have been a reliable pair for regular use.', '2025-07-12'),
    (3, 5.0, 'amazon', 'seed-amazon-p03-r04', 'Would buy again', 'I have been wearing the Crocs Classic Clogs regularly and the straps stay secure without rubbing. So far they have been a reliable pair for regular use.', '2025-04-22'),
    (3, 5.0, 'brand_site', 'seed-brand_site-p03-r05', 'Very comfortable', 'The Crocs Classic Clogs worked out really well for me; they dried quickly after getting wet. They have become one of the pairs I reach for most often.', '2026-03-02'),
    (3, 5.0, 'zappos', 'seed-zappos-p03-r06', 'Exactly what I wanted', 'The Crocs Classic Clogs worked out really well for me; they are easy to wear all day. They have become one of the pairs I reach for most often.', '2025-02-21'),
    (3, 5.0, 'rei', 'seed-rei-p03-r07', 'Very comfortable', 'I have been wearing the Crocs Classic Clogs regularly and they are easy to wear all day. Sizing was close to what I expected and I would buy them again.', '2026-01-09'),
    (3, 5.0, 'amazon', 'seed-amazon-p03-r08', 'Excellent pair', 'The Crocs Classic Clogs worked out really well for me; the footbed is comfortable for long walks. They have become one of the pairs I reach for most often.', '2025-11-14'),
    (3, 3.0, 'brand_site', 'seed-brand_site-p03-r09', 'Mixed feelings', 'There are things I like, especially that they dried quickly after getting wet, but the arch support was too pronounced for me. Not bad, but I would probably compare a few other options first.', '2025-03-10');

-- Product 4: Adidas Ultraboost Light (7 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (4, 3.0, 'zappos', 'seed-zappos-p04-r01', 'Fit was the main issue', 'I have mixed feelings about these. The ride felt smooth for daily miles, while the toe box felt narrower than expected. They may work better for someone with a different fit preference.', '2025-12-26'),
    (4, 5.0, 'brand_site', 'seed-brand_site-p04-r02', 'Excellent pair', 'After a few weeks with these, the ride felt smooth for daily miles. They have become one of the pairs I reach for most often.', '2026-04-28'),
    (4, 5.0, 'amazon', 'seed-amazon-p04-r03', 'Great everyday option', 'The Adidas Ultraboost Light worked out really well for me; the fit held my heel securely. They have become one of the pairs I reach for most often.', '2025-09-12'),
    (4, 5.0, 'rei', 'seed-rei-p04-r04', 'Excellent pair', 'I have been wearing the Adidas Ultraboost Light regularly and the upper stayed comfortable and breathable. They have become one of the pairs I reach for most often.', '2026-06-26'),
    (4, 5.0, 'zappos', 'seed-zappos-p04-r05', 'Excellent pair', 'After a few weeks with these, the upper stayed comfortable and breathable. They have become one of the pairs I reach for most often.', '2025-05-05'),
    (4, 5.0, 'brand_site', 'seed-brand_site-p04-r06', 'Excellent pair', 'After a few weeks with these, the fit held my heel securely. They have become one of the pairs I reach for most often.', '2026-07-31'),
    (4, 5.0, 'amazon', 'seed-amazon-p04-r07', 'Exactly what I wanted', 'After a few weeks with these, the grip felt dependable on wet pavement. So far they have been a reliable pair for regular use.', '2026-09-16');

-- Product 5: Dr. Martens 1460 Smooth Leather Boots (9 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (5, 5.0, 'brand_site', 'seed-brand_site-p05-r01', 'Exactly what I wanted', 'The Dr. Martens 1460 Smooth Leather Boots worked out really well for me; the sole has good traction. So far they have been a reliable pair for regular use.', '2026-05-15'),
    (5, 4.0, 'zappos', 'seed-zappos-p05-r02', 'Comfortable after break-in', 'I am happy with them for the most part. They became very comfortable after a short break-in; the leather showed creasing quickly. I would still recommend them, especially if you can try the sizing first.', '2026-06-16'),
    (5, 5.0, 'amazon', 'seed-amazon-p05-r03', 'Would buy again', 'I have been wearing the Dr. Martens 1460 Smooth Leather Boots regularly and they handled wet weather well. They have become one of the pairs I reach for most often.', '2025-07-13'),
    (5, 5.0, 'nordstrom', 'seed-nordstrom-p05-r04', 'Would buy again', 'After a few weeks with these, the leather feels sturdy and well finished. So far they have been a reliable pair for regular use.', '2026-05-25'),
    (5, 3.0, 'brand_site', 'seed-brand_site-p05-r05', 'Decent, but not perfect', 'There are things I like, especially that they became very comfortable after a short break-in, but the break-in period was rougher than expected. They may work better for someone with a different fit preference.', '2026-03-29'),
    (5, 5.0, 'zappos', 'seed-zappos-p05-r06', 'Very comfortable', 'The Dr. Martens 1460 Smooth Leather Boots worked out really well for me; they became very comfortable after a short break-in. Sizing was close to what I expected and I would buy them again.', '2026-06-01'),
    (5, 5.0, 'amazon', 'seed-amazon-p05-r07', 'Excellent pair', 'I have been wearing the Dr. Martens 1460 Smooth Leather Boots regularly and the ankle support feels solid. Sizing was close to what I expected and I would buy them again.', '2025-10-02'),
    (5, 4.0, 'nordstrom', 'seed-nordstrom-p05-r08', 'Comfortable after break-in', 'Overall I like the Dr. Martens 1460 Smooth Leather Boots. The ankle support feels solid, but the break-in period was rougher than expected. That was not a deal breaker for me, but it is worth keeping in mind.', '2025-03-11'),
    (5, 5.0, 'brand_site', 'seed-brand_site-p05-r09', 'Excellent pair', 'After a few weeks with these, they handled wet weather well. Sizing was close to what I expected and I would buy them again.', '2026-09-09');

-- Product 6: Vans Old Skool (9 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (6, 5.0, 'amazon', 'seed-amazon-p06-r01', 'Very comfortable', 'The Vans Old Skool worked out really well for me; the materials feel solid. Sizing was close to what I expected and I would buy them again.', '2025-07-01'),
    (6, 5.0, 'foot_locker', 'seed-foot_locker-p06-r02', 'Very comfortable', 'I have been wearing the Vans Old Skool regularly and they are comfortable for everyday wear. Sizing was close to what I expected and I would buy them again.', '2025-11-10'),
    (6, 5.0, 'brand_site', 'seed-brand_site-p06-r03', 'Very comfortable', 'After a few weeks with these, the shape looks great in person. They have become one of the pairs I reach for most often.', '2025-03-23'),
    (6, 5.0, 'zappos', 'seed-zappos-p06-r04', 'Great everyday option', 'The Vans Old Skool worked out really well for me; they are comfortable for everyday wear. Sizing was close to what I expected and I would buy them again.', '2025-11-22'),
    (6, 3.0, 'amazon', 'seed-amazon-p06-r05', 'Good in some ways', 'I have mixed feelings about these. They are comfortable for everyday wear, while the fit ran a little narrow. I will keep using them, but I expected a little more.', '2026-08-31'),
    (6, 4.0, 'foot_locker', 'seed-foot_locker-p06-r06', 'Good with a small caveat', 'These have been good overall: the cushioning is good for walking around all day, although the fit ran a little narrow. I would still recommend them, especially if you can try the sizing first.', '2025-03-10'),
    (6, 5.0, 'brand_site', 'seed-brand_site-p06-r07', 'Excellent pair', 'After a few weeks with these, the materials feel solid. They have become one of the pairs I reach for most often.', '2025-12-14'),
    (6, 5.0, 'zappos', 'seed-zappos-p06-r08', 'Great everyday option', 'I have been wearing the Vans Old Skool regularly and the shape looks great in person. Sizing was close to what I expected and I would buy them again.', '2026-01-03'),
    (6, 5.0, 'amazon', 'seed-amazon-p06-r09', 'Excellent pair', 'I have been wearing the Vans Old Skool regularly and the shape looks great in person. So far they have been a reliable pair for regular use.', '2026-09-08');

-- Product 7: Converse Chuck Taylor All Star (9 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (7, 5.0, 'zappos', 'seed-zappos-p07-r01', 'Exactly what I wanted', 'After a few weeks with these, the materials feel solid. They have become one of the pairs I reach for most often.', '2025-09-28'),
    (7, 5.0, 'amazon', 'seed-amazon-p07-r02', 'Would buy again', 'The Converse Chuck Taylor All Star worked out really well for me; the shape looks great in person. Sizing was close to what I expected and I would buy them again.', '2026-08-04'),
    (7, 5.0, 'brand_site', 'seed-brand_site-p07-r03', 'Very comfortable', 'The Converse Chuck Taylor All Star worked out really well for me; they are comfortable for everyday wear. So far they have been a reliable pair for regular use.', '2025-08-21'),
    (7, 5.0, 'foot_locker', 'seed-foot_locker-p07-r04', 'Exactly what I wanted', 'The Converse Chuck Taylor All Star worked out really well for me; the shape looks great in person. They have become one of the pairs I reach for most often.', '2025-09-25'),
    (7, 4.0, 'zappos', 'seed-zappos-p07-r05', 'Mostly impressed', 'Overall I like the Converse Chuck Taylor All Star. They are comfortable for everyday wear, but the tongue shifts around while walking. I would still recommend them, especially if you can try the sizing first.', '2026-05-18'),
    (7, 3.0, 'amazon', 'seed-amazon-p07-r06', 'Fit was the main issue', 'I have mixed feelings about these. The shape looks great in person, while they crease pretty quickly. Not bad, but I would probably compare a few other options first.', '2026-06-20'),
    (7, 4.0, 'brand_site', 'seed-brand_site-p07-r07', 'Comfortable after break-in', 'Overall I like the Converse Chuck Taylor All Star. The cushioning is good for walking around all day, but they crease pretty quickly. A solid pair overall with one minor drawback.', '2025-03-28'),
    (7, 5.0, 'foot_locker', 'seed-foot_locker-p07-r08', 'Would buy again', 'I have been wearing the Converse Chuck Taylor All Star regularly and the materials feel solid. So far they have been a reliable pair for regular use.', '2026-05-25'),
    (7, 5.0, 'zappos', 'seed-zappos-p07-r09', 'Exactly what I wanted', 'After a few weeks with these, the shape looks great in person. Sizing was close to what I expected and I would buy them again.', '2025-01-24');

-- Product 8: New Balance 574 Core (5 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (8, 3.0, 'amazon', 'seed-amazon-p08-r01', 'Decent, but not perfect', 'There are things I like, especially that the shape looks great in person, but the tongue shifts around while walking. Not bad, but I would probably compare a few other options first.', '2026-09-22'),
    (8, 5.0, 'zappos', 'seed-zappos-p08-r02', 'Excellent pair', 'The New Balance 574 Core worked out really well for me; the cushioning is good for walking around all day. So far they have been a reliable pair for regular use.', '2026-07-24'),
    (8, 5.0, 'brand_site', 'seed-brand_site-p08-r03', 'Excellent pair', 'I have been wearing the New Balance 574 Core regularly and the shape looks great in person. So far they have been a reliable pair for regular use.', '2026-02-23'),
    (8, 5.0, 'amazon', 'seed-amazon-p08-r04', 'Exactly what I wanted', 'I have been wearing the New Balance 574 Core regularly and the shape looks great in person. Sizing was close to what I expected and I would buy them again.', '2025-03-16'),
    (8, 4.0, 'zappos', 'seed-zappos-p08-r05', 'Good with a small caveat', 'I am happy with them for the most part. The cushioning is good for walking around all day; the tongue shifts around while walking. A solid pair overall with one minor drawback.', '2026-01-30');

-- Product 9: Puma Suede Classic XXI (5 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (9, 4.0, 'brand_site', 'seed-brand_site-p09-r01', 'Comfortable after break-in', 'These have been good overall: the shape looks great in person, although they needed a few wears to soften up. That was not a deal breaker for me, but it is worth keeping in mind.', '2026-05-20'),
    (9, 5.0, 'zappos', 'seed-zappos-p09-r02', 'Great everyday option', 'The Puma Suede Classic XXI worked out really well for me; the materials feel solid. Sizing was close to what I expected and I would buy them again.', '2026-01-30'),
    (9, 5.0, 'foot_locker', 'seed-foot_locker-p09-r03', 'Great everyday option', 'After a few weeks with these, the shape looks great in person. Sizing was close to what I expected and I would buy them again.', '2025-07-28'),
    (9, 3.0, 'brand_site', 'seed-brand_site-p09-r04', 'Mixed feelings', 'I have mixed feelings about these. The cushioning is good for walking around all day, while they crease pretty quickly. I will keep using them, but I expected a little more.', '2025-12-30'),
    (9, 5.0, 'zappos', 'seed-zappos-p09-r05', 'Very comfortable', 'The Puma Suede Classic XXI worked out really well for me; the cushioning is good for walking around all day. They have become one of the pairs I reach for most often.', '2025-01-19');

-- Product 10: Reebok Club C 85 (4 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (10, 4.0, 'amazon', 'seed-amazon-p10-r01', 'Good with a small caveat', 'These have been good overall: the cushioning is good for walking around all day, although they crease pretty quickly. That was not a deal breaker for me, but it is worth keeping in mind.', '2025-09-22'),
    (10, 4.0, 'zappos', 'seed-zappos-p10-r02', 'Good with a small caveat', 'These have been good overall: the cushioning is good for walking around all day, although the fit ran a little narrow. A solid pair overall with one minor drawback.', '2025-08-02'),
    (10, 5.0, 'brand_site', 'seed-brand_site-p10-r03', 'Great everyday option', 'After a few weeks with these, the shape looks great in person. Sizing was close to what I expected and I would buy them again.', '2025-02-13'),
    (10, 5.0, 'amazon', 'seed-amazon-p10-r04', 'Exactly what I wanted', 'The Reebok Club C 85 worked out really well for me; the cushioning is good for walking around all day. Sizing was close to what I expected and I would buy them again.', '2026-06-17');

-- Product 11: Asics Gel-Kayano 30 (9 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (11, 5.0, 'amazon', 'seed-amazon-p11-r01', 'Excellent pair', 'I have been wearing the Asics Gel-Kayano 30 regularly and the ride felt smooth for daily miles. They have become one of the pairs I reach for most often.', '2026-03-10'),
    (11, 4.0, 'rei', 'seed-rei-p11-r02', 'Good with a small caveat', 'These have been good overall: the grip felt dependable on wet pavement, although the heel rubbed during the first few wears. That was not a deal breaker for me, but it is worth keeping in mind.', '2025-06-12'),
    (11, 5.0, 'zappos', 'seed-zappos-p11-r03', 'Very comfortable', 'After a few weeks with these, cushioning felt good on longer runs. They have become one of the pairs I reach for most often.', '2025-04-07'),
    (11, 3.0, 'brand_site', 'seed-brand_site-p11-r04', 'Decent, but not perfect', 'There are things I like, especially that the grip felt dependable on wet pavement, but the heel rubbed during the first few wears. They may work better for someone with a different fit preference.', '2025-09-06'),
    (11, 5.0, 'amazon', 'seed-amazon-p11-r05', 'Great everyday option', 'The Asics Gel-Kayano 30 worked out really well for me; the ride felt smooth for daily miles. They have become one of the pairs I reach for most often.', '2026-04-22'),
    (11, 5.0, 'rei', 'seed-rei-p11-r06', 'Very comfortable', 'The Asics Gel-Kayano 30 worked out really well for me; the grip felt dependable on wet pavement. They have become one of the pairs I reach for most often.', '2025-06-17'),
    (11, 5.0, 'zappos', 'seed-zappos-p11-r07', 'Exactly what I wanted', 'The Asics Gel-Kayano 30 worked out really well for me; the ride felt smooth for daily miles. They have become one of the pairs I reach for most often.', '2026-04-14'),
    (11, 5.0, 'brand_site', 'seed-brand_site-p11-r08', 'Exactly what I wanted', 'After a few weeks with these, the grip felt dependable on wet pavement. So far they have been a reliable pair for regular use.', '2025-12-29'),
    (11, 5.0, 'amazon', 'seed-amazon-p11-r09', 'Excellent pair', 'I have been wearing the Asics Gel-Kayano 30 regularly and the ride felt smooth for daily miles. Sizing was close to what I expected and I would buy them again.', '2026-08-20');

-- Product 12: Brooks Ghost 15 (9 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (12, 5.0, 'amazon', 'seed-amazon-p12-r01', 'Great everyday option', 'The Brooks Ghost 15 worked out really well for me; the fit held my heel securely. Sizing was close to what I expected and I would buy them again.', '2025-08-12'),
    (12, 5.0, 'zappos', 'seed-zappos-p12-r02', 'Very comfortable', 'The Brooks Ghost 15 worked out really well for me; the ride felt smooth for daily miles. Sizing was close to what I expected and I would buy them again.', '2025-07-25'),
    (12, 5.0, 'rei', 'seed-rei-p12-r03', 'Great everyday option', 'I have been wearing the Brooks Ghost 15 regularly and the upper stayed comfortable and breathable. Sizing was close to what I expected and I would buy them again.', '2025-05-09'),
    (12, 5.0, 'brand_site', 'seed-brand_site-p12-r04', 'Would buy again', 'The Brooks Ghost 15 worked out really well for me; the ride felt smooth for daily miles. They have become one of the pairs I reach for most often.', '2026-05-17'),
    (12, 3.0, 'amazon', 'seed-amazon-p12-r05', 'Average for me', 'There are things I like, especially that the ride felt smooth for daily miles, but the fit ran slightly small for me. Not bad, but I would probably compare a few other options first.', '2026-07-10'),
    (12, 5.0, 'zappos', 'seed-zappos-p12-r06', 'Exactly what I wanted', 'I have been wearing the Brooks Ghost 15 regularly and the ride felt smooth for daily miles. So far they have been a reliable pair for regular use.', '2025-06-22'),
    (12, 5.0, 'rei', 'seed-rei-p12-r07', 'Would buy again', 'After a few weeks with these, the ride felt smooth for daily miles. So far they have been a reliable pair for regular use.', '2025-06-17'),
    (12, 5.0, 'brand_site', 'seed-brand_site-p12-r08', 'Excellent pair', 'The Brooks Ghost 15 worked out really well for me; the upper stayed comfortable and breathable. Sizing was close to what I expected and I would buy them again.', '2026-03-06'),
    (12, 5.0, 'amazon', 'seed-amazon-p12-r09', 'Exactly what I wanted', 'I have been wearing the Brooks Ghost 15 regularly and the upper stayed comfortable and breathable. So far they have been a reliable pair for regular use.', '2025-11-09');

-- Product 13: Hoka Clifton 9 (8 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (13, 5.0, 'amazon', 'seed-amazon-p13-r01', 'Exactly what I wanted', 'After a few weeks with these, the fit held my heel securely. So far they have been a reliable pair for regular use.', '2025-04-14'),
    (13, 3.0, 'zappos', 'seed-zappos-p13-r02', 'Fit was the main issue', 'I have mixed feelings about these. Cushioning felt good on longer runs, while the fit ran slightly small for me. I will keep using them, but I expected a little more.', '2025-04-12'),
    (13, 5.0, 'rei', 'seed-rei-p13-r03', 'Very comfortable', 'The Hoka Clifton 9 worked out really well for me; the fit held my heel securely. So far they have been a reliable pair for regular use.', '2026-07-25'),
    (13, 5.0, 'brand_site', 'seed-brand_site-p13-r04', 'Would buy again', 'I have been wearing the Hoka Clifton 9 regularly and the grip felt dependable on wet pavement. Sizing was close to what I expected and I would buy them again.', '2026-09-04'),
    (13, 5.0, 'amazon', 'seed-amazon-p13-r05', 'Exactly what I wanted', 'After a few weeks with these, the fit held my heel securely. They have become one of the pairs I reach for most often.', '2026-09-26'),
    (13, 5.0, 'zappos', 'seed-zappos-p13-r06', 'Excellent pair', 'After a few weeks with these, the upper stayed comfortable and breathable. So far they have been a reliable pair for regular use.', '2026-05-01'),
    (13, 5.0, 'rei', 'seed-rei-p13-r07', 'Very comfortable', 'After a few weeks with these, the fit held my heel securely. Sizing was close to what I expected and I would buy them again.', '2025-08-15'),
    (13, 5.0, 'brand_site', 'seed-brand_site-p13-r08', 'Exactly what I wanted', 'After a few weeks with these, the grip felt dependable on wet pavement. So far they have been a reliable pair for regular use.', '2025-02-27');

-- Product 14: Saucony Ride 16 (5 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (14, 5.0, 'brand_site', 'seed-brand_site-p14-r01', 'Great everyday option', 'I have been wearing the Saucony Ride 16 regularly and the upper stayed comfortable and breathable. So far they have been a reliable pair for regular use.', '2025-04-17'),
    (14, 3.0, 'amazon', 'seed-amazon-p14-r02', 'Mixed feelings', 'I have mixed feelings about these. The fit held my heel securely, while the cushioning felt a little firmer than I wanted. Not bad, but I would probably compare a few other options first.', '2025-12-11'),
    (14, 5.0, 'zappos', 'seed-zappos-p14-r03', 'Exactly what I wanted', 'After a few weeks with these, cushioning felt good on longer runs. So far they have been a reliable pair for regular use.', '2025-02-24'),
    (14, 5.0, 'brand_site', 'seed-brand_site-p14-r04', 'Great everyday option', 'I have been wearing the Saucony Ride 16 regularly and cushioning felt good on longer runs. Sizing was close to what I expected and I would buy them again.', '2025-12-26'),
    (14, 5.0, 'amazon', 'seed-amazon-p14-r05', 'Very comfortable', 'I have been wearing the Saucony Ride 16 regularly and cushioning felt good on longer runs. They have become one of the pairs I reach for most often.', '2025-03-01');

-- Product 15: On Cloud 5 (5 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (15, 5.0, 'amazon', 'seed-amazon-p15-r01', 'Great everyday option', 'After a few weeks with these, the upper stayed comfortable and breathable. So far they have been a reliable pair for regular use.', '2025-03-25'),
    (15, 5.0, 'zappos', 'seed-zappos-p15-r02', 'Great everyday option', 'After a few weeks with these, the ride felt smooth for daily miles. So far they have been a reliable pair for regular use.', '2025-11-04'),
    (15, 5.0, 'brand_site', 'seed-brand_site-p15-r03', 'Very comfortable', 'The On Cloud 5 worked out really well for me; the ride felt smooth for daily miles. They have become one of the pairs I reach for most often.', '2026-01-06'),
    (15, 3.0, 'amazon', 'seed-amazon-p15-r04', 'Decent, but not perfect', 'There are things I like, especially that cushioning felt good on longer runs, but the fit ran slightly small for me. I will keep using them, but I expected a little more.', '2025-08-26'),
    (15, 4.0, 'zappos', 'seed-zappos-p15-r05', 'Solid choice', 'I am happy with them for the most part. The upper stayed comfortable and breathable; the fit ran slightly small for me. I would still recommend them, especially if you can try the sizing first.', '2025-11-02');

-- Product 16: Jordan 1 Retro High OG (9 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (16, 5.0, 'amazon', 'seed-amazon-p16-r01', 'Great everyday option', 'The Jordan 1 Retro High OG worked out really well for me; they were easy to style with different outfits. They have become one of the pairs I reach for most often.', '2025-08-13'),
    (16, 5.0, 'zappos', 'seed-zappos-p16-r02', 'Very comfortable', 'The Jordan 1 Retro High OG worked out really well for me; the materials feel solid. They have become one of the pairs I reach for most often.', '2025-04-09'),
    (16, 5.0, 'brand_site', 'seed-brand_site-p16-r03', 'Excellent pair', 'I have been wearing the Jordan 1 Retro High OG regularly and the cushioning is good for walking around all day. They have become one of the pairs I reach for most often.', '2026-09-06'),
    (16, 3.0, 'foot_locker', 'seed-foot_locker-p16-r04', 'Decent, but not perfect', 'I have mixed feelings about these. The shape looks great in person, while the tongue shifts around while walking. They may work better for someone with a different fit preference.', '2025-12-17'),
    (16, 5.0, 'amazon', 'seed-amazon-p16-r05', 'Would buy again', 'After a few weeks with these, the cushioning is good for walking around all day. They have become one of the pairs I reach for most often.', '2026-08-05'),
    (16, 5.0, 'zappos', 'seed-zappos-p16-r06', 'Very comfortable', 'After a few weeks with these, they are comfortable for everyday wear. So far they have been a reliable pair for regular use.', '2025-03-23'),
    (16, 5.0, 'brand_site', 'seed-brand_site-p16-r07', 'Great everyday option', 'The Jordan 1 Retro High OG worked out really well for me; the cushioning is good for walking around all day. They have become one of the pairs I reach for most often.', '2026-02-28'),
    (16, 5.0, 'foot_locker', 'seed-foot_locker-p16-r08', 'Exactly what I wanted', 'The Jordan 1 Retro High OG worked out really well for me; they are comfortable for everyday wear. So far they have been a reliable pair for regular use.', '2026-03-16'),
    (16, 5.0, 'amazon', 'seed-amazon-p16-r09', 'Great everyday option', 'The Jordan 1 Retro High OG worked out really well for me; the cushioning is good for walking around all day. So far they have been a reliable pair for regular use.', '2026-01-03');

-- Product 17: Nike Dunk Low (7 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (17, 5.0, 'zappos', 'seed-zappos-p17-r01', 'Very comfortable', 'The Nike Dunk Low worked out really well for me; the cushioning is good for walking around all day. So far they have been a reliable pair for regular use.', '2025-04-07'),
    (17, 5.0, 'amazon', 'seed-amazon-p17-r02', 'Exactly what I wanted', 'The Nike Dunk Low worked out really well for me; the cushioning is good for walking around all day. Sizing was close to what I expected and I would buy them again.', '2025-03-16'),
    (17, 5.0, 'brand_site', 'seed-brand_site-p17-r03', 'Excellent pair', 'After a few weeks with these, the materials feel solid. So far they have been a reliable pair for regular use.', '2025-12-29'),
    (17, 3.0, 'foot_locker', 'seed-foot_locker-p17-r04', 'Decent, but not perfect', 'There are things I like, especially that they were easy to style with different outfits, but they crease pretty quickly. I will keep using them, but I expected a little more.', '2025-08-23'),
    (17, 5.0, 'zappos', 'seed-zappos-p17-r05', 'Would buy again', 'I have been wearing the Nike Dunk Low regularly and the shape looks great in person. So far they have been a reliable pair for regular use.', '2026-05-14'),
    (17, 5.0, 'amazon', 'seed-amazon-p17-r06', 'Very comfortable', 'After a few weeks with these, they were easy to style with different outfits. Sizing was close to what I expected and I would buy them again.', '2025-09-20'),
    (17, 5.0, 'brand_site', 'seed-brand_site-p17-r07', 'Exactly what I wanted', 'I have been wearing the Nike Dunk Low regularly and they were easy to style with different outfits. They have become one of the pairs I reach for most often.', '2026-05-12');

-- Product 18: Adidas Samba OG (7 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (18, 5.0, 'foot_locker', 'seed-foot_locker-p18-r01', 'Exactly what I wanted', 'I have been wearing the Adidas Samba OG regularly and the cushioning is good for walking around all day. So far they have been a reliable pair for regular use.', '2026-09-17'),
    (18, 4.0, 'brand_site', 'seed-brand_site-p18-r02', 'Good with a small caveat', 'Overall I like the Adidas Samba OG. The cushioning is good for walking around all day, but the fit ran a little narrow. A solid pair overall with one minor drawback.', '2025-04-12'),
    (18, 5.0, 'zappos', 'seed-zappos-p18-r03', 'Excellent pair', 'The Adidas Samba OG worked out really well for me; the materials feel solid. Sizing was close to what I expected and I would buy them again.', '2026-05-11'),
    (18, 5.0, 'amazon', 'seed-amazon-p18-r04', 'Excellent pair', 'After a few weeks with these, the shape looks great in person. They have become one of the pairs I reach for most often.', '2025-09-03'),
    (18, 5.0, 'foot_locker', 'seed-foot_locker-p18-r05', 'Would buy again', 'I have been wearing the Adidas Samba OG regularly and the shape looks great in person. They have become one of the pairs I reach for most often.', '2026-05-16'),
    (18, 5.0, 'brand_site', 'seed-brand_site-p18-r06', 'Would buy again', 'After a few weeks with these, they are comfortable for everyday wear. So far they have been a reliable pair for regular use.', '2025-02-11'),
    (18, 5.0, 'zappos', 'seed-zappos-p18-r07', 'Excellent pair', 'The Adidas Samba OG worked out really well for me; the cushioning is good for walking around all day. Sizing was close to what I expected and I would buy them again.', '2026-04-15');

-- Product 19: Nike Air Max 90 (4 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (19, 4.0, 'amazon', 'seed-amazon-p19-r01', 'Good with a small caveat', 'I am happy with them for the most part. They are comfortable for everyday wear; they needed a few wears to soften up. I would still recommend them, especially if you can try the sizing first.', '2025-04-04'),
    (19, 5.0, 'brand_site', 'seed-brand_site-p19-r02', 'Exactly what I wanted', 'After a few weeks with these, the cushioning is good for walking around all day. Sizing was close to what I expected and I would buy them again.', '2025-09-06'),
    (19, 5.0, 'foot_locker', 'seed-foot_locker-p19-r03', 'Exactly what I wanted', 'After a few weeks with these, the materials feel solid. Sizing was close to what I expected and I would buy them again.', '2026-08-07'),
    (19, 4.0, 'amazon', 'seed-amazon-p19-r04', 'Good with a small caveat', 'I am happy with them for the most part. The materials feel solid; they crease pretty quickly. That was not a deal breaker for me, but it is worth keeping in mind.', '2026-09-28');

-- Product 20: Adidas Stan Smith (4 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (20, 5.0, 'zappos', 'seed-zappos-p20-r01', 'Very comfortable', 'I have been wearing the Adidas Stan Smith regularly and the materials feel solid. Sizing was close to what I expected and I would buy them again.', '2026-05-10'),
    (20, 5.0, 'brand_site', 'seed-brand_site-p20-r02', 'Excellent pair', 'After a few weeks with these, they are comfortable for everyday wear. So far they have been a reliable pair for regular use.', '2025-04-24'),
    (20, 4.0, 'foot_locker', 'seed-foot_locker-p20-r03', 'Mostly impressed', 'I am happy with them for the most part. They were easy to style with different outfits; they crease pretty quickly. I would still recommend them, especially if you can try the sizing first.', '2025-02-18'),
    (20, 4.0, 'zappos', 'seed-zappos-p20-r04', 'Solid choice', 'I am happy with them for the most part. The materials feel solid; the cushioning is flatter than I expected. I would still recommend them, especially if you can try the sizing first.', '2026-07-07');

-- Product 21: Birkenstock Arizona Soft Footbed (8 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (21, 5.0, 'zappos', 'seed-zappos-p21-r01', 'Very comfortable', 'The Birkenstock Arizona Soft Footbed worked out really well for me; the sole has better support than most sandals. So far they have been a reliable pair for regular use.', '2026-06-05'),
    (21, 5.0, 'amazon', 'seed-amazon-p21-r02', 'Would buy again', 'I have been wearing the Birkenstock Arizona Soft Footbed regularly and they dried quickly after getting wet. Sizing was close to what I expected and I would buy them again.', '2025-05-19'),
    (21, 5.0, 'brand_site', 'seed-brand_site-p21-r03', 'Would buy again', 'I have been wearing the Birkenstock Arizona Soft Footbed regularly and the straps stay secure without rubbing. They have become one of the pairs I reach for most often.', '2026-01-22'),
    (21, 5.0, 'rei', 'seed-rei-p21-r04', 'Exactly what I wanted', 'I have been wearing the Birkenstock Arizona Soft Footbed regularly and the straps stay secure without rubbing. So far they have been a reliable pair for regular use.', '2026-06-26'),
    (21, 5.0, 'zappos', 'seed-zappos-p21-r05', 'Would buy again', 'After a few weeks with these, they are easy to wear all day. So far they have been a reliable pair for regular use.', '2025-09-24'),
    (21, 3.0, 'amazon', 'seed-amazon-p21-r06', 'Mixed feelings', 'There are things I like, especially that the sole has better support than most sandals, but the footbed felt stiff at first. I will keep using them, but I expected a little more.', '2025-01-21'),
    (21, 5.0, 'brand_site', 'seed-brand_site-p21-r07', 'Great everyday option', 'I have been wearing the Birkenstock Arizona Soft Footbed regularly and the straps stay secure without rubbing. Sizing was close to what I expected and I would buy them again.', '2025-02-25'),
    (21, 5.0, 'rei', 'seed-rei-p21-r08', 'Exactly what I wanted', 'After a few weeks with these, they dried quickly after getting wet. Sizing was close to what I expected and I would buy them again.', '2025-05-24');

-- Product 22: Teva Original Universal Sandals (5 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (22, 3.0, 'rei', 'seed-rei-p22-r01', 'Good in some ways', 'There are things I like, especially that they are easy to wear all day, but the straps loosened more than I expected. Not bad, but I would probably compare a few other options first.', '2025-02-13'),
    (22, 5.0, 'zappos', 'seed-zappos-p22-r02', 'Exactly what I wanted', 'After a few weeks with these, the sole has better support than most sandals. Sizing was close to what I expected and I would buy them again.', '2025-07-03'),
    (22, 5.0, 'brand_site', 'seed-brand_site-p22-r03', 'Exactly what I wanted', 'After a few weeks with these, they are easy to wear all day. So far they have been a reliable pair for regular use.', '2026-07-27'),
    (22, 5.0, 'rei', 'seed-rei-p22-r04', 'Great everyday option', 'I have been wearing the Teva Original Universal Sandals regularly and the straps stay secure without rubbing. Sizing was close to what I expected and I would buy them again.', '2026-06-12'),
    (22, 5.0, 'zappos', 'seed-zappos-p22-r05', 'Great everyday option', 'The Teva Original Universal Sandals worked out really well for me; the footbed is comfortable for long walks. They have become one of the pairs I reach for most often.', '2025-11-24');

-- Product 23: Chaco Z/Cloud Sandals (5 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (23, 5.0, 'brand_site', 'seed-brand_site-p23-r01', 'Would buy again', 'I have been wearing the Chaco Z/Cloud Sandals regularly and the footbed is comfortable for long walks. So far they have been a reliable pair for regular use.', '2025-04-11'),
    (23, 4.0, 'rei', 'seed-rei-p23-r02', 'Solid choice', 'These have been good overall: they are easy to wear all day, although the footbed felt stiff at first. That was not a deal breaker for me, but it is worth keeping in mind.', '2025-07-25'),
    (23, 5.0, 'zappos', 'seed-zappos-p23-r03', 'Very comfortable', 'I have been wearing the Chaco Z/Cloud Sandals regularly and the sole has better support than most sandals. Sizing was close to what I expected and I would buy them again.', '2025-10-13'),
    (23, 5.0, 'brand_site', 'seed-brand_site-p23-r04', 'Would buy again', 'After a few weeks with these, the sole has better support than most sandals. So far they have been a reliable pair for regular use.', '2025-03-17'),
    (23, 5.0, 'rei', 'seed-rei-p23-r05', 'Excellent pair', 'I have been wearing the Chaco Z/Cloud Sandals regularly and they are easy to wear all day. They have become one of the pairs I reach for most often.', '2026-05-14');

-- Product 24: Vionic Tide II Sandals (5 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (24, 5.0, 'amazon', 'seed-amazon-p24-r01', 'Very comfortable', 'After a few weeks with these, the straps stay secure without rubbing. So far they have been a reliable pair for regular use.', '2026-02-03'),
    (24, 4.0, 'brand_site', 'seed-brand_site-p24-r02', 'Mostly impressed', 'I am happy with them for the most part. They are easy to wear all day; the fit ran slightly short. I would still recommend them, especially if you can try the sizing first.', '2025-03-03'),
    (24, 5.0, 'rei', 'seed-rei-p24-r03', 'Exactly what I wanted', 'The Vionic Tide II Sandals worked out really well for me; the footbed is comfortable for long walks. They have become one of the pairs I reach for most often.', '2025-07-22'),
    (24, 5.0, 'amazon', 'seed-amazon-p24-r04', 'Would buy again', 'I have been wearing the Vionic Tide II Sandals regularly and the footbed is comfortable for long walks. They have become one of the pairs I reach for most often.', '2025-06-02'),
    (24, 3.0, 'brand_site', 'seed-brand_site-p24-r05', 'Mixed feelings', 'There are things I like, especially that they dried quickly after getting wet, but the footbed felt stiff at first. I will keep using them, but I expected a little more.', '2025-03-22');

-- Product 25: Clarks Desert Boot (5 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (25, 5.0, 'brand_site', 'seed-brand_site-p25-r01', 'Exactly what I wanted', 'After a few weeks with these, the ankle support feels solid. Sizing was close to what I expected and I would buy them again.', '2026-06-10'),
    (25, 3.0, 'zappos', 'seed-zappos-p25-r02', 'Fit was the main issue', 'The Clarks Desert Boot are okay overall. The ankle support feels solid, but the ankle area rubbed at first. They may work better for someone with a different fit preference.', '2026-06-30'),
    (25, 5.0, 'nordstrom', 'seed-nordstrom-p25-r03', 'Excellent pair', 'The Clarks Desert Boot worked out really well for me; the leather feels sturdy and well finished. Sizing was close to what I expected and I would buy them again.', '2026-02-06'),
    (25, 5.0, 'brand_site', 'seed-brand_site-p25-r04', 'Excellent pair', 'After a few weeks with these, they became very comfortable after a short break-in. They have become one of the pairs I reach for most often.', '2025-09-09'),
    (25, 5.0, 'zappos', 'seed-zappos-p25-r05', 'Would buy again', 'I have been wearing the Clarks Desert Boot regularly and they became very comfortable after a short break-in. Sizing was close to what I expected and I would buy them again.', '2026-03-24');

-- Product 26: Red Wing Classic Moc Toe (8 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (26, 5.0, 'brand_site', 'seed-brand_site-p26-r01', 'Would buy again', 'The Red Wing Classic Moc Toe worked out really well for me; they became very comfortable after a short break-in. Sizing was close to what I expected and I would buy them again.', '2026-06-06'),
    (26, 5.0, 'amazon', 'seed-amazon-p26-r02', 'Great everyday option', 'The Red Wing Classic Moc Toe worked out really well for me; the sole has good traction. Sizing was close to what I expected and I would buy them again.', '2026-08-30'),
    (26, 5.0, 'zappos', 'seed-zappos-p26-r03', 'Very comfortable', 'I have been wearing the Red Wing Classic Moc Toe regularly and the sole has good traction. So far they have been a reliable pair for regular use.', '2025-03-13'),
    (26, 5.0, 'nordstrom', 'seed-nordstrom-p26-r04', 'Excellent pair', 'I have been wearing the Red Wing Classic Moc Toe regularly and the ankle support feels solid. Sizing was close to what I expected and I would buy them again.', '2026-08-20'),
    (26, 5.0, 'brand_site', 'seed-brand_site-p26-r05', 'Excellent pair', 'I have been wearing the Red Wing Classic Moc Toe regularly and the ankle support feels solid. Sizing was close to what I expected and I would buy them again.', '2026-09-18'),
    (26, 5.0, 'amazon', 'seed-amazon-p26-r06', 'Very comfortable', 'After a few weeks with these, the leather feels sturdy and well finished. Sizing was close to what I expected and I would buy them again.', '2026-08-24'),
    (26, 5.0, 'zappos', 'seed-zappos-p26-r07', 'Would buy again', 'I have been wearing the Red Wing Classic Moc Toe regularly and they handled wet weather well. So far they have been a reliable pair for regular use.', '2025-06-10'),
    (26, 3.0, 'nordstrom', 'seed-nordstrom-p26-r08', 'Mixed feelings', 'I have mixed feelings about these. They became very comfortable after a short break-in, while the fit ran a little large. They may work better for someone with a different fit preference.', '2026-07-09');

-- Product 27: Blundstone 500 Chelsea Boots (9 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (27, 5.0, 'zappos', 'seed-zappos-p27-r01', 'Excellent pair', 'After a few weeks with these, the ankle support feels solid. So far they have been a reliable pair for regular use.', '2026-09-05'),
    (27, 5.0, 'brand_site', 'seed-brand_site-p27-r02', 'Great everyday option', 'I have been wearing the Blundstone 500 Chelsea Boots regularly and the leather feels sturdy and well finished. Sizing was close to what I expected and I would buy them again.', '2026-07-11'),
    (27, 5.0, 'nordstrom', 'seed-nordstrom-p27-r03', 'Would buy again', 'The Blundstone 500 Chelsea Boots worked out really well for me; the leather feels sturdy and well finished. So far they have been a reliable pair for regular use.', '2025-06-04'),
    (27, 5.0, 'amazon', 'seed-amazon-p27-r04', 'Excellent pair', 'After a few weeks with these, they handled wet weather well. They have become one of the pairs I reach for most often.', '2026-03-17'),
    (27, 5.0, 'zappos', 'seed-zappos-p27-r05', 'Excellent pair', 'After a few weeks with these, they handled wet weather well. Sizing was close to what I expected and I would buy them again.', '2026-09-01'),
    (27, 5.0, 'brand_site', 'seed-brand_site-p27-r06', 'Would buy again', 'The Blundstone 500 Chelsea Boots worked out really well for me; the ankle support feels solid. They have become one of the pairs I reach for most often.', '2025-12-16'),
    (27, 5.0, 'nordstrom', 'seed-nordstrom-p27-r07', 'Exactly what I wanted', 'I have been wearing the Blundstone 500 Chelsea Boots regularly and they handled wet weather well. Sizing was close to what I expected and I would buy them again.', '2025-11-24'),
    (27, 3.0, 'amazon', 'seed-amazon-p27-r08', 'Mixed feelings', 'I have mixed feelings about these. The sole has good traction, while the break-in period was rougher than expected. They may work better for someone with a different fit preference.', '2025-04-08'),
    (27, 4.0, 'zappos', 'seed-zappos-p27-r09', 'Good with a small caveat', 'I am happy with them for the most part. They became very comfortable after a short break-in; they feel heavy after several hours. That was not a deal breaker for me, but it is worth keeping in mind.', '2025-03-23');

-- Product 28: Sorel Caribou Waterproof Boots (4 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (28, 4.0, 'brand_site', 'seed-brand_site-p28-r01', 'Solid choice', 'These have been good overall: the leather feels sturdy and well finished, although the fit ran a little large. That was not a deal breaker for me, but it is worth keeping in mind.', '2025-06-27'),
    (28, 4.0, 'amazon', 'seed-amazon-p28-r02', 'Mostly impressed', 'Overall I like the Sorel Caribou Waterproof Boots. They handled wet weather well, but the break-in period was rougher than expected. A solid pair overall with one minor drawback.', '2025-08-25'),
    (28, 5.0, 'zappos', 'seed-zappos-p28-r03', 'Very comfortable', 'After a few weeks with these, they handled wet weather well. They have become one of the pairs I reach for most often.', '2026-06-25'),
    (28, 5.0, 'brand_site', 'seed-brand_site-p28-r04', 'Exactly what I wanted', 'After a few weeks with these, the sole has good traction. So far they have been a reliable pair for regular use.', '2026-07-23');

-- Product 29: Hunter Original Tall Rain Boots (4 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (29, 5.0, 'amazon', 'seed-amazon-p29-r01', 'Would buy again', 'I have been wearing the Hunter Original Tall Rain Boots regularly and the sole has good traction. Sizing was close to what I expected and I would buy them again.', '2025-06-11'),
    (29, 4.0, 'zappos', 'seed-zappos-p29-r02', 'Solid choice', 'These have been good overall: they handled wet weather well, although the fit ran a little large. A solid pair overall with one minor drawback.', '2026-04-01'),
    (29, 5.0, 'brand_site', 'seed-brand_site-p29-r03', 'Exactly what I wanted', 'After a few weeks with these, the sole has good traction. So far they have been a reliable pair for regular use.', '2026-05-03'),
    (29, 4.0, 'amazon', 'seed-amazon-p29-r04', 'Comfortable after break-in', 'I am happy with them for the most part. The sole has good traction; the leather showed creasing quickly. I would still recommend them, especially if you can try the sizing first.', '2026-01-14');

-- Product 30: UGG Classic Mini II Boots (4 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (30, 5.0, 'amazon', 'seed-amazon-p30-r01', 'Would buy again', 'The UGG Classic Mini II Boots worked out really well for me; the sole has good traction. So far they have been a reliable pair for regular use.', '2026-10-01'),
    (30, 5.0, 'brand_site', 'seed-brand_site-p30-r02', 'Great everyday option', 'After a few weeks with these, they became very comfortable after a short break-in. So far they have been a reliable pair for regular use.', '2026-01-03'),
    (30, 5.0, 'zappos', 'seed-zappos-p30-r03', 'Excellent pair', 'I have been wearing the UGG Classic Mini II Boots regularly and the sole has good traction. Sizing was close to what I expected and I would buy them again.', '2026-05-11'),
    (30, 4.0, 'amazon', 'seed-amazon-p30-r04', 'Very good overall', 'I am happy with them for the most part. They became very comfortable after a short break-in; the fit ran a little large. I would still recommend them, especially if you can try the sizing first.', '2025-06-28');

-- Product 31: Steve Madden Lando Loafers (2 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (31, 4.0, 'zappos', 'seed-zappos-p31-r01', 'Solid choice', 'I am happy with them for the most part. They stayed comfortable through a full workday; the sole is a little slick on smooth floors. A solid pair overall with one minor drawback.', '2025-07-24'),
    (31, 5.0, 'brand_site', 'seed-brand_site-p31-r02', 'Very comfortable', 'I have been wearing the Steve Madden Lando Loafers regularly and the cushioning is better than I expected for this style. Sizing was close to what I expected and I would buy them again.', '2026-03-12');

-- Product 32: Cole Haan OriginalGrand Wingtip (2 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (32, 4.0, 'nordstrom', 'seed-nordstrom-p32-r01', 'Solid choice', 'I am happy with them for the most part. They look polished without feeling too stiff; the fit felt narrow across the forefoot. A solid pair overall with one minor drawback.', '2025-02-05'),
    (32, 5.0, 'dsw', 'seed-dsw-p32-r02', 'Great everyday option', 'The Cole Haan OriginalGrand Wingtip worked out really well for me; the cushioning is better than I expected for this style. They have become one of the pairs I reach for most often.', '2026-03-03');

-- Product 33: Allen Edmonds Park Avenue (2 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (33, 5.0, 'dsw', 'seed-dsw-p33-r01', 'Great everyday option', 'I have been wearing the Allen Edmonds Park Avenue regularly and the cushioning is better than I expected for this style. So far they have been a reliable pair for regular use.', '2026-07-07'),
    (33, 5.0, 'zappos', 'seed-zappos-p33-r02', 'Very comfortable', 'I have been wearing the Allen Edmonds Park Avenue regularly and the cushioning is better than I expected for this style. So far they have been a reliable pair for regular use.', '2025-08-19');

-- Product 34: Clarks Wallabee (5 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (34, 5.0, 'brand_site', 'seed-brand_site-p34-r01', 'Very comfortable', 'The Clarks Wallabee worked out really well for me; the leather feels nice for the price. So far they have been a reliable pair for regular use.', '2026-04-18'),
    (34, 5.0, 'nordstrom', 'seed-nordstrom-p34-r02', 'Exactly what I wanted', 'I have been wearing the Clarks Wallabee regularly and they look polished without feeling too stiff. Sizing was close to what I expected and I would buy them again.', '2026-02-28'),
    (34, 5.0, 'zappos', 'seed-zappos-p34-r03', 'Exactly what I wanted', 'After a few weeks with these, they stayed comfortable through a full workday. They have become one of the pairs I reach for most often.', '2026-05-09'),
    (34, 3.0, 'brand_site', 'seed-brand_site-p34-r04', 'Mixed feelings', 'The Clarks Wallabee are okay overall. They stayed comfortable through a full workday, but the fit felt narrow across the forefoot. Not bad, but I would probably compare a few other options first.', '2025-12-29'),
    (34, 5.0, 'nordstrom', 'seed-nordstrom-p34-r05', 'Would buy again', 'I have been wearing the Clarks Wallabee regularly and the leather feels nice for the price. They have become one of the pairs I reach for most often.', '2026-01-27');

-- Product 35: Toms Alpargata Classic (3 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (35, 5.0, 'brand_site', 'seed-brand_site-p35-r01', 'Very comfortable', 'I have been wearing the Toms Alpargata Classic regularly and the cushioning is better than I expected for this style. So far they have been a reliable pair for regular use.', '2026-09-05'),
    (35, 4.0, 'dsw', 'seed-dsw-p35-r02', 'Good with a small caveat', 'I am happy with them for the most part. The cushioning is better than i expected for this style; the sole is a little slick on smooth floors. A solid pair overall with one minor drawback.', '2026-09-21'),
    (35, 4.0, 'brand_site', 'seed-brand_site-p35-r03', 'Good with a small caveat', 'These have been good overall: the fit works well for office wear, although the sole is a little slick on smooth floors. That was not a deal breaker for me, but it is worth keeping in mind.', '2025-07-29');

-- Product 36: Sperry Authentic Original 2-Eye (2 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (36, 5.0, 'nordstrom', 'seed-nordstrom-p36-r01', 'Very comfortable', 'I have been wearing the Sperry Authentic Original 2-Eye regularly and the cushioning is better than I expected for this style. So far they have been a reliable pair for regular use.', '2026-02-11'),
    (36, 4.0, 'brand_site', 'seed-brand_site-p36-r02', 'Solid choice', 'I am happy with them for the most part. They stayed comfortable through a full workday; the sizing felt inconsistent. A solid pair overall with one minor drawback.', '2025-09-28');

-- Product 37: Moccasin House Driving Moc (3 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (37, 5.0, 'nordstrom', 'seed-nordstrom-p37-r01', 'Very comfortable', 'The Moccasin House Driving Moc worked out really well for me; they stayed comfortable through a full workday. Sizing was close to what I expected and I would buy them again.', '2025-05-30'),
    (37, 4.0, 'zappos', 'seed-zappos-p37-r02', 'Very good overall', 'I am happy with them for the most part. They look polished without feeling too stiff; the fit felt narrow across the forefoot. That was not a deal breaker for me, but it is worth keeping in mind.', '2026-05-08'),
    (37, 4.0, 'nordstrom', 'seed-nordstrom-p37-r03', 'Solid choice', 'These have been good overall: the leather feels nice for the price, although they needed more break-in than I expected. A solid pair overall with one minor drawback.', '2025-09-22');

-- Product 38: Allbirds Tree Runners (9 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (38, 4.0, 'zappos', 'seed-zappos-p38-r01', 'Very good overall', 'Overall I like the Allbirds Tree Runners. Cushioning felt good on longer runs, but the shoe felt heavier than expected. That was not a deal breaker for me, but it is worth keeping in mind.', '2026-04-10'),
    (38, 5.0, 'amazon', 'seed-amazon-p38-r02', 'Exactly what I wanted', 'The Allbirds Tree Runners worked out really well for me; the upper stayed comfortable and breathable. Sizing was close to what I expected and I would buy them again.', '2026-01-17'),
    (38, 5.0, 'brand_site', 'seed-brand_site-p38-r03', 'Excellent pair', 'I have been wearing the Allbirds Tree Runners regularly and the fit held my heel securely. Sizing was close to what I expected and I would buy them again.', '2025-03-30'),
    (38, 5.0, 'rei', 'seed-rei-p38-r04', 'Excellent pair', 'The Allbirds Tree Runners worked out really well for me; cushioning felt good on longer runs. So far they have been a reliable pair for regular use.', '2025-05-16'),
    (38, 3.0, 'zappos', 'seed-zappos-p38-r05', 'Fit was the main issue', 'There are things I like, especially that the fit held my heel securely, but the cushioning felt a little firmer than I wanted. I will keep using them, but I expected a little more.', '2026-06-07'),
    (38, 4.0, 'amazon', 'seed-amazon-p38-r06', 'Very good overall', 'I am happy with them for the most part. The grip felt dependable on wet pavement; the heel rubbed during the first few wears. That was not a deal breaker for me, but it is worth keeping in mind.', '2026-02-20'),
    (38, 5.0, 'brand_site', 'seed-brand_site-p38-r07', 'Very comfortable', 'I have been wearing the Allbirds Tree Runners regularly and the ride felt smooth for daily miles. They have become one of the pairs I reach for most often.', '2025-11-20'),
    (38, 5.0, 'rei', 'seed-rei-p38-r08', 'Would buy again', 'The Allbirds Tree Runners worked out really well for me; the ride felt smooth for daily miles. They have become one of the pairs I reach for most often.', '2025-12-16'),
    (38, 4.0, 'zappos', 'seed-zappos-p38-r09', 'Solid choice', 'Overall I like the Allbirds Tree Runners. The fit held my heel securely, but the heel rubbed during the first few wears. I would still recommend them, especially if you can try the sizing first.', '2025-03-18');

-- Product 39: Veja Campo Leather (5 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (39, 3.0, 'amazon', 'seed-amazon-p39-r01', 'Decent, but not perfect', 'There are things I like, especially that the cushioning is good for walking around all day, but the fit ran a little narrow. I will keep using them, but I expected a little more.', '2025-03-17'),
    (39, 5.0, 'brand_site', 'seed-brand_site-p39-r02', 'Excellent pair', 'I have been wearing the Veja Campo Leather regularly and they are comfortable for everyday wear. So far they have been a reliable pair for regular use.', '2026-06-26'),
    (39, 4.0, 'zappos', 'seed-zappos-p39-r03', 'Solid choice', 'These have been good overall: the materials feel solid, although the tongue shifts around while walking. That was not a deal breaker for me, but it is worth keeping in mind.', '2026-09-07'),
    (39, 5.0, 'amazon', 'seed-amazon-p39-r04', 'Great everyday option', 'I have been wearing the Veja Campo Leather regularly and they were easy to style with different outfits. Sizing was close to what I expected and I would buy them again.', '2025-01-17'),
    (39, 5.0, 'brand_site', 'seed-brand_site-p39-r05', 'Would buy again', 'After a few weeks with these, the materials feel solid. They have become one of the pairs I reach for most often.', '2025-05-17');

-- Product 40: Common Projects Original Achilles (2 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (40, 5.0, 'zappos', 'seed-zappos-p40-r01', 'Would buy again', 'I have been wearing the Common Projects Original Achilles regularly and the materials feel solid. Sizing was close to what I expected and I would buy them again.', '2025-03-01'),
    (40, 4.0, 'amazon', 'seed-amazon-p40-r02', 'Solid choice', 'Overall I like the Common Projects Original Achilles. They were easy to style with different outfits, but the tongue shifts around while walking. I would still recommend them, especially if you can try the sizing first.', '2026-07-31');

-- Product 41: Salomon XT-6 (7 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (41, 5.0, 'brand_site', 'seed-brand_site-p41-r01', 'Would buy again', 'After a few weeks with these, the grip felt dependable on wet pavement. They have become one of the pairs I reach for most often.', '2025-01-17'),
    (41, 5.0, 'rei', 'seed-rei-p41-r02', 'Great everyday option', 'After a few weeks with these, the ride felt smooth for daily miles. So far they have been a reliable pair for regular use.', '2025-10-10'),
    (41, 5.0, 'amazon', 'seed-amazon-p41-r03', 'Exactly what I wanted', 'After a few weeks with these, the upper stayed comfortable and breathable. They have become one of the pairs I reach for most often.', '2025-01-28'),
    (41, 3.0, 'zappos', 'seed-zappos-p41-r04', 'Mixed feelings', 'The Salomon XT-6 are okay overall. The upper stayed comfortable and breathable, but the toe box felt narrower than expected. I will keep using them, but I expected a little more.', '2025-03-01'),
    (41, 5.0, 'brand_site', 'seed-brand_site-p41-r05', 'Great everyday option', 'I have been wearing the Salomon XT-6 regularly and the ride felt smooth for daily miles. They have become one of the pairs I reach for most often.', '2026-08-06'),
    (41, 5.0, 'rei', 'seed-rei-p41-r06', 'Would buy again', 'I have been wearing the Salomon XT-6 regularly and the upper stayed comfortable and breathable. So far they have been a reliable pair for regular use.', '2025-06-30'),
    (41, 5.0, 'amazon', 'seed-amazon-p41-r07', 'Great everyday option', 'I have been wearing the Salomon XT-6 regularly and the ride felt smooth for daily miles. They have become one of the pairs I reach for most often.', '2025-03-07');

-- Product 42: Merrell Moab 3 Hiking Shoes (8 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (42, 3.0, 'amazon', 'seed-amazon-p42-r01', 'Average for me', 'There are things I like, especially that the fit held my heel securely, but the fit ran slightly small for me. I will keep using them, but I expected a little more.', '2025-03-06'),
    (42, 5.0, 'zappos', 'seed-zappos-p42-r02', 'Would buy again', 'After a few weeks with these, the fit held my heel securely. They have become one of the pairs I reach for most often.', '2026-06-17'),
    (42, 5.0, 'rei', 'seed-rei-p42-r03', 'Great everyday option', 'The Merrell Moab 3 Hiking Shoes worked out really well for me; the ride felt smooth for daily miles. They have become one of the pairs I reach for most often.', '2026-08-19'),
    (42, 5.0, 'brand_site', 'seed-brand_site-p42-r04', 'Exactly what I wanted', 'The Merrell Moab 3 Hiking Shoes worked out really well for me; the ride felt smooth for daily miles. So far they have been a reliable pair for regular use.', '2026-08-21'),
    (42, 4.0, 'amazon', 'seed-amazon-p42-r05', 'Mostly impressed', 'These have been good overall: the ride felt smooth for daily miles, although the cushioning felt a little firmer than I wanted. That was not a deal breaker for me, but it is worth keeping in mind.', '2025-12-26'),
    (42, 5.0, 'zappos', 'seed-zappos-p42-r06', 'Great everyday option', 'The Merrell Moab 3 Hiking Shoes worked out really well for me; the grip felt dependable on wet pavement. They have become one of the pairs I reach for most often.', '2025-01-25'),
    (42, 5.0, 'rei', 'seed-rei-p42-r07', 'Exactly what I wanted', 'The Merrell Moab 3 Hiking Shoes worked out really well for me; the upper stayed comfortable and breathable. So far they have been a reliable pair for regular use.', '2025-06-20'),
    (42, 5.0, 'brand_site', 'seed-brand_site-p42-r08', 'Great everyday option', 'I have been wearing the Merrell Moab 3 Hiking Shoes regularly and the fit held my heel securely. So far they have been a reliable pair for regular use.', '2026-09-08');

-- Product 43: Keen Targhee III Waterproof (5 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (43, 5.0, 'brand_site', 'seed-brand_site-p43-r01', 'Great everyday option', 'The Keen Targhee III Waterproof worked out really well for me; the ride felt smooth for daily miles. So far they have been a reliable pair for regular use.', '2025-08-19'),
    (43, 4.0, 'amazon', 'seed-amazon-p43-r02', 'Solid choice', 'These have been good overall: the fit held my heel securely, although the shoe felt heavier than expected. I would still recommend them, especially if you can try the sizing first.', '2025-09-02'),
    (43, 5.0, 'zappos', 'seed-zappos-p43-r03', 'Great everyday option', 'The Keen Targhee III Waterproof worked out really well for me; the ride felt smooth for daily miles. They have become one of the pairs I reach for most often.', '2025-07-24'),
    (43, 3.0, 'brand_site', 'seed-brand_site-p43-r04', 'Mixed feelings', 'I have mixed feelings about these. The ride felt smooth for daily miles, while the toe box felt narrower than expected. Not bad, but I would probably compare a few other options first.', '2025-05-14'),
    (43, 5.0, 'amazon', 'seed-amazon-p43-r05', 'Very comfortable', 'I have been wearing the Keen Targhee III Waterproof regularly and the grip felt dependable on wet pavement. So far they have been a reliable pair for regular use.', '2026-09-02');

-- Product 44: La Sportiva Tarantulace (3 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (44, 5.0, 'rei', 'seed-rei-p44-r01', 'Would buy again', 'I have been wearing the La Sportiva Tarantulace regularly and the rubber felt grippy on indoor holds. They have become one of the pairs I reach for most often.', '2026-03-23'),
    (44, 4.0, 'brand_site', 'seed-brand_site-p44-r02', 'Very good overall', 'These have been good overall: they were comfortable for longer gym sessions, although the rubber felt less sticky on small edges than I wanted. A solid pair overall with one minor drawback.', '2025-11-13'),
    (44, 4.0, 'rei', 'seed-rei-p44-r03', 'Good with a small caveat', 'These have been good overall: the rubber felt grippy on indoor holds, although the toe box felt cramped. That was not a deal breaker for me, but it is worth keeping in mind.', '2025-05-26');

-- Product 45: Nike Pegasus 40 (9 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (45, 5.0, 'brand_site', 'seed-brand_site-p45-r01', 'Excellent pair', 'After a few weeks with these, cushioning felt good on longer runs. Sizing was close to what I expected and I would buy them again.', '2025-11-13'),
    (45, 4.0, 'rei', 'seed-rei-p45-r02', 'Comfortable after break-in', 'I am happy with them for the most part. The ride felt smooth for daily miles; the shoe felt heavier than expected. I would still recommend them, especially if you can try the sizing first.', '2025-11-28'),
    (45, 5.0, 'amazon', 'seed-amazon-p45-r03', 'Would buy again', 'I have been wearing the Nike Pegasus 40 regularly and the ride felt smooth for daily miles. Sizing was close to what I expected and I would buy them again.', '2026-09-16'),
    (45, 5.0, 'zappos', 'seed-zappos-p45-r04', 'Excellent pair', 'The Nike Pegasus 40 worked out really well for me; cushioning felt good on longer runs. They have become one of the pairs I reach for most often.', '2025-04-21'),
    (45, 5.0, 'brand_site', 'seed-brand_site-p45-r05', 'Very comfortable', 'The Nike Pegasus 40 worked out really well for me; the upper stayed comfortable and breathable. They have become one of the pairs I reach for most often.', '2025-01-19'),
    (45, 5.0, 'rei', 'seed-rei-p45-r06', 'Great everyday option', 'I have been wearing the Nike Pegasus 40 regularly and the upper stayed comfortable and breathable. Sizing was close to what I expected and I would buy them again.', '2025-02-04'),
    (45, 5.0, 'amazon', 'seed-amazon-p45-r07', 'Would buy again', 'After a few weeks with these, the ride felt smooth for daily miles. So far they have been a reliable pair for regular use.', '2025-07-03'),
    (45, 5.0, 'zappos', 'seed-zappos-p45-r08', 'Exactly what I wanted', 'After a few weeks with these, the grip felt dependable on wet pavement. They have become one of the pairs I reach for most often.', '2026-08-09'),
    (45, 3.0, 'brand_site', 'seed-brand_site-p45-r09', 'Mixed feelings', 'The Nike Pegasus 40 are okay overall. The grip felt dependable on wet pavement, but the heel rubbed during the first few wears. Not bad, but I would probably compare a few other options first.', '2026-03-27');

-- Product 46: Under Armour Charged Assert 10 (2 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (46, 4.0, 'amazon', 'seed-amazon-p46-r01', 'Comfortable after break-in', 'These have been good overall: the grip felt dependable on wet pavement, although the toe box felt narrower than expected. That was not a deal breaker for me, but it is worth keeping in mind.', '2025-05-09'),
    (46, 5.0, 'brand_site', 'seed-brand_site-p46-r02', 'Would buy again', 'After a few weeks with these, the ride felt smooth for daily miles. Sizing was close to what I expected and I would buy them again.', '2025-03-13');

-- Product 47: Mizuno Wave Rider 27 (3 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (47, 5.0, 'zappos', 'seed-zappos-p47-r01', 'Great everyday option', 'The Mizuno Wave Rider 27 worked out really well for me; the fit held my heel securely. So far they have been a reliable pair for regular use.', '2026-09-04'),
    (47, 4.0, 'amazon', 'seed-amazon-p47-r02', 'Good with a small caveat', 'These have been good overall: the ride felt smooth for daily miles, although the shoe felt heavier than expected. That was not a deal breaker for me, but it is worth keeping in mind.', '2026-08-19'),
    (47, 5.0, 'zappos', 'seed-zappos-p47-r03', 'Very comfortable', 'After a few weeks with these, the grip felt dependable on wet pavement. So far they have been a reliable pair for regular use.', '2025-10-30');

-- Product 48: Fila Disruptor 2 (2 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (48, 4.0, 'brand_site', 'seed-brand_site-p48-r01', 'Comfortable after break-in', 'I am happy with them for the most part. The materials feel solid; the tongue shifts around while walking. I would still recommend them, especially if you can try the sizing first.', '2026-02-02'),
    (48, 4.0, 'zappos', 'seed-zappos-p48-r02', 'Solid choice', 'These have been good overall: they are comfortable for everyday wear, although the fit ran a little narrow. I would still recommend them, especially if you can try the sizing first.', '2025-05-17');

-- Product 49: Reef Santa Ana Flip Flops (3 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (49, 5.0, 'zappos', 'seed-zappos-p49-r01', 'Excellent pair', 'The Reef Santa Ana Flip Flops worked out really well for me; they dried quickly after getting wet. So far they have been a reliable pair for regular use.', '2025-05-04'),
    (49, 4.0, 'amazon', 'seed-amazon-p49-r02', 'Very good overall', 'I am happy with them for the most part. The footbed is comfortable for long walks; the fit ran slightly short. A solid pair overall with one minor drawback.', '2025-06-29'),
    (49, 4.0, 'zappos', 'seed-zappos-p49-r03', 'Good with a small caveat', 'I am happy with them for the most part. They are easy to wear all day; the footbed felt stiff at first. A solid pair overall with one minor drawback.', '2025-07-22');

-- Product 50: Rainbow Premier Leather Sandals (3 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (50, 4.0, 'brand_site', 'seed-brand_site-p50-r01', 'Good with a small caveat', 'I am happy with them for the most part. They dried quickly after getting wet; the footbed felt stiff at first. A solid pair overall with one minor drawback.', '2025-02-17'),
    (50, 5.0, 'rei', 'seed-rei-p50-r02', 'Excellent pair', 'After a few weeks with these, the straps stay secure without rubbing. So far they have been a reliable pair for regular use.', '2026-06-08'),
    (50, 5.0, 'brand_site', 'seed-brand_site-p50-r03', 'Would buy again', 'The Rainbow Premier Leather Sandals worked out really well for me; the sole has better support than most sandals. They have become one of the pairs I reach for most often.', '2025-03-12');

-- Product 51: Aldo Stessy Ballet Flats (2 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (51, 4.0, 'brand_site', 'seed-brand_site-p51-r01', 'Good with a small caveat', 'These have been good overall: the fit works well for office wear, although the sole is a little slick on smooth floors. I would still recommend them, especially if you can try the sizing first.', '2025-05-06'),
    (51, 4.0, 'nordstrom', 'seed-nordstrom-p51-r02', 'Solid choice', 'I am happy with them for the most part. They look polished without feeling too stiff; the fit felt narrow across the forefoot. A solid pair overall with one minor drawback.', '2026-09-26');

-- Product 52: Sam Edelman Loraine Loafers (3 reviews)
INSERT INTO reviews (product_id, rating, source, source_review_id, title, body, review_date) VALUES
    (52, 5.0, 'nordstrom', 'seed-nordstrom-p52-r01', 'Excellent pair', 'The Sam Edelman Loraine Loafers worked out really well for me; the cushioning is better than I expected for this style. So far they have been a reliable pair for regular use.', '2026-07-05'),
    (52, 5.0, 'brand_site', 'seed-brand_site-p52-r02', 'Exactly what I wanted', 'After a few weeks with these, they look polished without feeling too stiff. Sizing was close to what I expected and I would buy them again.', '2026-07-17'),
    (52, 4.0, 'nordstrom', 'seed-nordstrom-p52-r03', 'Mostly impressed', 'I am happy with them for the most part. The fit works well for office wear; the fit felt narrow across the forefoot. That was not a deal breaker for me, but it is worth keeping in mind.', '2025-02-10');
