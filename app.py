import os
import io
import unicodedata
import numpy as np
import streamlit as st
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

st.set_page_config(page_title="10面カード作成ツール", layout="wide")

PRESETS = {
    "1. 不快スイッチ（10選）": {
        "tag": "不快スイッチ",
        "footer": "TURN Training",
        "text": """チャットが短文だと<br>冷たく感じる
用件以外のことを長々と<br>書かれると、面倒に感じる
人前で注意されると<br>萎縮する
個別に回りくどく言われると、<br>本質が見えずビクビクしてしまう
細かく確認されると<br>信頼されていないように感じる
放置されると<br>不安になる
メールで済む内容を突然<br>電話で返されると、<br>作業が中断されて焦る
チャットだけで済まされると、<br>意図や感情が正確に<br>伝わらず不安になる
画面を見たまま返事されると<br>軽く扱われた気がする
目を見て話されると<br>圧が強くて怖い"""
    },
    "2. Thinkカード（10選）": {
        "tag": "Thinkカード",
        "footer": "TURN Training",
        "text": """「なる早」で<br>お願いします
「ちゃんと」<br>確認しておいて
「いい感じに」<br>まとめておいて
「適当に」<br>対応しといて
「例の件」<br>どうなった？
「ざっくり」<br>でいいから教えて
「近いうちに」<br>打ち合わせしよう
「手が空いたとき」に<br>やっておいて
「ちょっと」<br>話あるんだけど
「常識的に考えて」<br>やってみて"""
    },
    "3. Navigateカード（10選）": {
        "tag": "Navigateカード",
        "footer": "TURN Training",
        "text": """「何か手伝えること<br>ある？」
「ここまでで<br>気になる点はある？」
「◯日◯時までに<br>終われば大丈夫です」
「相談してくれて<br>ありがとう」
「どこで困っているか<br>教えて？」
「いま5分だけ<br>時間大丈夫？」
「念のため前提を<br>確認させて」
「いつもサポート<br>助かっているよ」
「無理そうなら<br>早めに教えてね」
「まずは一度<br>ここで手を止めよう」"""
    }
}

def create_fallback_frame():
    canvas_w, canvas_h = 2373, 3379
    img = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    dash_color = (180, 180, 180, 255)
    x_coords = [158, 1233, 2307]
    y_coords = [128, 777, 1426, 2075, 2725, 3376]
    for x in x_coords:
        for y in range(y_coords[0], y_coords[-1], 20):
            draw.line([(x, y), (x, min(y + 10, y_coords[-1]))], fill=dash_color, width=3)
    for y in y_coords:
        for x in range(x_coords[0], x_coords[-1], 20):
            draw.line([(x, y), (min(x + 10, x_coords[-1]), y)], fill=dash_color, width=3)
    return img

def get_frame_image(uploaded_file):
    if uploaded_file is not None:
        try:
            return Image.open(uploaded_file).convert('RGBA')
        except Exception:
            pass

    for filename in os.listdir('.'):
        normalized = unicodedata.normalize('NFC', filename)
        if ("カード" in normalized or "本家" in normalized or "input_file" in normalized) and normalized.endswith(('.png', '.jpg', '.jpeg')):
            try:
                return Image.open(filename).convert('RGBA')
            except Exception:
                pass

    return create_fallback_frame()

def generate_card_layers(card_lines, tag_title, footer_title, frame_img):
    canvas_w, canvas_h = 2373, 3379
    x_coords = [158, 1233, 2307]
    y_coords = [128, 777, 1426, 2075, 2725, 3376]

    text_layer = Image.new('RGBA', (canvas_w, canvas_h), (255, 255, 255, 255))
    draw = ImageDraw.Draw(text_layer)

    font_path_candidates = [
        '/System/Library/Fonts/Supplemental/ヒラギノ角ゴ ProN W6.ttc',
        '/System/Library/Fonts/Hiragino Sans GB.ttc',
        '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc',
        '/Library/Fonts/ヒラギノ角ゴ ProN W6.otf',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
        'C:/Windows/Fonts/meiryo.ttc'
    ]
    font_tag = font_text = font_footer = None
    for fpath in font_path_candidates:
        if os.path.exists(fpath):
            try:
                font_tag = ImageFont.truetype(fpath, 42)
                font_text = ImageFont.truetype(fpath, 50)
                font_footer = ImageFont.truetype(fpath, 28)
                break
            except Exception:
                pass
    if font_tag is None:
        font_tag = font_text = font_footer = ImageFont.load_default()

    for i, text in enumerate(card_lines[:10]):
        col = i % 2
        row = i // 2
        
        box_x0 = x_coords[col]
        box_x1 = x_coords[col + 1]
        box_y0 = y_coords[row]
        box_y1 = y_coords[row + 1]
        
        cx = (box_x0 + box_x1) / 2.0
        cy = (box_y0 + box_y1) / 2.0
        
        tag_w, tag_h = 320, 70
        tag_x0 = cx - tag_w / 2.0
        tag_y0 = box_y0 + 70
        draw.rounded_rectangle([tag_x0, tag_y0, tag_x0 + tag_w, tag_y0 + tag_h], radius=18, fill=(45, 55, 72))
        draw.text((cx, tag_y0 + tag_h/2.0), tag_title, fill=(255, 255, 255), font=font_tag, anchor='mm')
        
        clean_text = text.replace('<br>', '\n')
        draw.text((cx, cy + 20), clean_text, fill=(26, 32, 44), font=font_text, anchor='mm', align='center', spacing=30)
        
        draw.text((box_x1 - 40, box_y1 - 40), footer_title, fill=(160, 174, 192), font=font_footer, anchor='rb')

    composite_layer = text_layer.copy()
    if frame_img is not None:
        try:
            f_img = frame_img.convert('RGBA')
            if f_img.size != (canvas_w, canvas_h):
                f_img = f_img.resize((canvas_w, canvas_h))

            arr_frame = np.array(f_img)
            if len(arr_frame.shape) == 3 and arr_frame.shape[2] == 4:
                rgb_part = arr_frame[:, :, :3]
                is_white = np.all(rgb_part >= 240, axis=2)
                arr_frame[is_white, 3] = 0
                processed_frame = Image.fromarray(arr_frame)
                composite_layer = Image.alpha_composite(text_layer, processed_frame)
            else:
                composite_layer = Image.alpha_composite(text_layer, f_img)
        except Exception:
            pass

    return text_layer, composite_layer

def convert_to_pdf_bytes(pil_img):
    pdf_buffer = io.BytesIO()
    c = canvas.Canvas(pdf_buffer, pagesize=A4)
    page_w, page_h = A4
    rgb_img = pil_img.convert('RGB')
    c.drawImage(ImageReader(rgb_img), 0, 0, width=page_w, height=page_h)
    c.save()
    return pdf_buffer.getvalue()

st.title("🎴 10面カード作成ツール")

left_col, right_col = st.columns([1, 1], gap="medium")

with left_col:
    st.subheader("📝 入力設定")
    selected_preset_key = st.selectbox("パターン選択", list(PRESETS.keys()))
    preset = PRESETS[selected_preset_key]

    c1, c2 = st.columns(2)
    with c1:
        tag_name = st.text_input("タグ名", value=preset["tag"])
    with c2:
        footer_name = st.text_input("フッター表記", value=preset["footer"])

    text_area_input = st.text_area("カードテキスト（10項目固定）", value=preset["text"], height=150)
    
    st.markdown("---")
    uploaded_frame = st.file_uploader("📁 枠画像のアップロード（変更したい場合のみ）", type=["png", "jpg", "jpeg"])

card_lines = [line.strip() for line in text_area_input.strip().split("\n") if line.strip()]
frame_img_data = get_frame_image(uploaded_frame)
text_only_img, frame_overlaid_img = generate_card_layers(card_lines, tag_name, footer_name, frame_img_data)

with right_col:
    st.subheader("🖼️ プレビュー & 保存")
    
    show_frame = st.checkbox("枠画像を重ねて表示", value=True)
    display_img = frame_overlaid_img if show_frame else text_only_img
    
    st.image(display_img)
    
    pdf_data = convert_to_pdf_bytes(display_img)
    st.download_button(
        label="💾 印刷用PDFを保存",
        data=pdf_data,
        file_name="card_print_final.pdf",
        mime="application/pdf"
    )
