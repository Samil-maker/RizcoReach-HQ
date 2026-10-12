// Ad Library-shaped test data. Mirrors the fields Meta returns in
// ad_library_main.search_results_connection (GraphQL) and the embedded first page.
const DAY = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);

export function makeAd({ id, pageId, pageName, daysAgo = 30, active = true, link = null, cta = 'LEARN_MORE', ctaText = 'Learn more', body = '', caption = '', likes = 1200, count = 1, category = 'Car Wash' }) {
  return {
    ad_archive_id: String(id),
    ad_id: null,
    collation_count: count,
    collation_id: String(id) + '9',
    end_date: nowSec() + DAY,
    entity_type: 'PERSON_PROFILE',
    is_active: active,
    page_id: String(pageId),
    page_is_deleted: false,
    page_name: pageName,
    publisher_platform: ['FACEBOOK', 'INSTAGRAM'],
    start_date: nowSec() - daysAgo * DAY,
    snapshot: {
      body: { text: body },
      caption,
      cards: [],
      cta_text: ctaText,
      cta_type: cta,
      display_format: 'IMAGE',
      link_url: link,
      page_categories: [category],
      page_id: String(pageId),
      page_like_count: likes,
      page_name: pageName,
      page_profile_picture_url: '',
      page_profile_uri: `https://www.facebook.com/${pageName.toLowerCase().replace(/[^a-z0-9]/g, '')}/`,
      title: pageName,
    },
  };
}

export function searchResponse(ads, { cursor = 'c1', hasNext = true } = {}) {
  return {
    data: {
      ad_library_main: {
        search_results_connection: {
          count: 1234,
          page_info: { end_cursor: cursor, has_next_page: hasNext },
          edges: ads.map((ad) => ({ node: { collated_results: [ad] } })),
        },
      },
    },
    extensions: { is_final: true },
  };
}

export const SAMPLE_ADS = [
  makeAd({ id: 1001, pageId: 501, pageName: 'Shine Auto Spa', daysAgo: 64, link: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fshineautospa.example%2Fceramic%3Futm_source%3Dfb&h=AT0', caption: 'shineautospa.example', count: 3 }),
  makeAd({ id: 1002, pageId: 501, pageName: 'Shine Auto Spa', daysAgo: 12, link: 'https://shineautospa.example/ceramic?utm_source=ig' }),
  makeAd({ id: 1003, pageId: 502, pageName: 'Desert Detailers', daysAgo: 9, cta: 'WHATSAPP_MESSAGE', ctaText: 'Send WhatsApp message', link: 'https://api.whatsapp.com/send?phone=971501234567', body: 'Full detail from AED 299. Call 04 123 4567 today!' }),
  makeAd({ id: 1004, pageId: 503, pageName: 'Gloss Garage Dubai', daysAgo: 120, link: 'http://glossgarage.example/', likes: 4100 }),
  makeAd({ id: 1005, pageId: 504, pageName: 'MegaMotors Official', daysAgo: 400, link: 'https://megamotors.example/', likes: 900000 }),
  makeAd({ id: 1006, pageId: 505, pageName: 'Parked Polish', daysAgo: 40, link: 'https://parkedpolish.example/' }),
];
