import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from 'file:///C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';

const ROOT='E:/TLCN/medabe';
const BASE=path.join(ROOT,'thuyet-trinh');
const BUILD=path.join(BASE,'.build');
const OUT=path.join(BASE,'output');
const SKILL='C:/Users/ASUS/.codex/plugins/cache/openai-primary-runtime/presentations/26.1025.11240/skills/presentations';
const PYTHON='C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
await fs.mkdir(path.join(BUILD,'renders'),{recursive:true});
await fs.mkdir(OUT,{recursive:true});
const P=Presentation.create({slideSize:{width:1280,height:720}});
const C={ink:'#123E3B',muted:'#526A68',teal:'#087E73',mint:'#86E7CA',paper:'#FFFFFF',pale:'#F0F6F5',red:'#AF3C3C',amber:'#926319',dark:'#103330'};
const manifest=[];

function txt(s,text,x,y,w,h,size=26,color=C.ink,bold=false,align='left'){
  const sh=s.shapes.add({name:`text-${s.shapes.items.length+1}`,geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
  sh.text=text;
  sh.text.style={typeface:'Arial',fontSize:size,color,bold,alignment:align,verticalAlignment:'top',insets:0,autoFit:'none',wrap:'square'};
  return sh;
}
function slide(title,{dark=false,subtitle=''}={}){
  const s=P.slides.add();s.background.fill=dark?C.dark:C.paper;
  const n=P.slides.items.length;
  txt(s,title,68,48,1144,96,44,dark?C.paper:C.ink,true);
  if(subtitle)txt(s,subtitle,70,144,1130,60,25,dark?'#BBDCD4':C.muted);
  txt(s,String(n).padStart(2,'0')+' / 15',1110,674,100,24,17,dark?'#BBDCD4':C.muted,false,'right');
  manifest.push({slide:n,title});
  return s;
}
function note(s,text,sources){
  s.speakerNotes.text=text+'\n\nNGUỒN TRONG DỰ ÁN\n'+sources.map(v=>ROOT+'/'+v).join('\n');
}
function table(s,values,{x=70,y=212,w=1140,h=350,widths,font=25,rowHeights,dark=false}={}){
  const rows=values.length,cols=values[0].length;
  const t=s.tables.add({rows,columns:cols,left:x,top:y,width:w,height:h,columnWidths:widths??Array(cols).fill(w/cols),values});
  t.cells.block({row:0,column:0,rowCount:rows,columnCount:cols}).assign({fill:dark?'#1A4944':C.pale,textStyle:{fontSize:font,typeface:'Arial',color:dark?C.paper:C.ink},margins:{left:18,right:18,top:14,bottom:12}});
  t.borders.assign({style:'solid',fill:dark?C.dark:C.paper,width:2});
  for(let r=0;r<rows;r++){
    if(rowHeights)t.rows[r].height=rowHeights[r];
    for(let c=0;c<cols;c++){
      if(r===0){t.getCell(r,c).fill=dark?'#245B52':C.ink;t.getCell(r,c).text.style={fontSize:font,typeface:'Arial',color:C.paper,bold:true};}
      else if(r%2===0)t.getCell(r,c).fill=dark?'#15403C':'#F8FAFA';
    }
  }
  return t;
}
function point(s,n,title,body,{x=70,y=210,w=1100,dark=false}={}){
  txt(s,String(n).padStart(2,'0'),x,y,66,50,36,dark?C.mint:C.teal,true);
  txt(s,title,x+88,y,w-88,44,29,dark?C.paper:C.ink,true);
  txt(s,body,x+88,y+47,w-88,74,25,dark?'#CCE1DC':C.muted);
}

// 1. Minimal cover, with the project's original artwork.
{
 const s=slide('MedABE',{dark:true});
 txt(s,'Mã hóa dựa trên thuộc tính\ntrong hệ thống khám sức khỏe',70,208,1100,178,57,C.paper,true);
 txt(s,'CP-ABE, cấp khóa ngưỡng và vòng đời quyền truy cập',73,426,1110,70,29,'#BBDCD4');
 txt(s,'Quyền đọc nằm trong chính sách của bản mã',73,557,1090,52,33,C.mint,true);
 const b=await fs.readFile(path.join(ROOT,'app/web/public/ksk-logo.png'));
 s.images.add({blob:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),contentType:'image/png',alt:'Logo KSK của dự án MedABE',fit:'contain',position:{left:1090,top:35,width:100,height:100}});
 note(s,`THỜI LƯỢNG GỢI Ý: 45 giây.
LỜI TRÌNH BÀY: Em trình bày cách MedABE dùng mã hóa dựa trên thuộc tính để bảo vệ từng phần của phiếu khám. Trọng tâm là ai có thể giải mã dữ liệu, khóa được sinh ra thế nào và điều gì xảy ra khi người dùng bị thu hồi quyền. Phía nhân viên dùng CP-ABE kết hợp AES-256-GCM. Ba nút cùng tham gia cấp khóa theo ngưỡng hai trên ba. Các lớp định danh, chữ ký số và giám sát hỗ trợ việc vận hành.
Thông điệp cần giữ xuyên suốt là: nhận được bản mã chưa đồng nghĩa đọc được nội dung. Tuy nhiên, hệ thống có các đường truy cập khác, đặc biệt kênh phụ huynh dùng cơ chế bọc khóa riêng. Em sẽ nêu rõ phạm vi đó ở phần cuối.
CHUYỂN TRANG: Trước hết, vì sao hệ thống cần ABE khi đã có đăng nhập và phân quyền thông thường?`,['TONG_HOP_ABE_VA_HE_THONG.md','TINH_NANG_ABE/README.md']);
}
// 2. Problem and threat model.
{
 const s=slide('Bài toán bảo vệ hồ sơ khám sức khỏe',{subtitle:'Mục tiêu: giữ bí mật nội dung khi người quan sát có bản mã nhưng thiếu khóa phù hợp'});
 table(s,[['Tình huống','Yêu cầu bảo vệ'],['Lộ kho lưu trữ hoặc gói tin LAN','Nội dung hồ sơ vẫn ở dạng mã hóa'],['Tiếp đón mở mục lâm sàng Nhi','Thiếu thuộc tính nên không giải mã được'],['Một nút cấp khóa bị chiếm','Một phần khóa không đủ tạo khóa hợp lệ'],['Nhân viên nghỉ việc','Ngừng cấp khóa và chuyển sang epoch mới']],{h:368,widths:[510,630],font:25});
 txt(s,'Máy chủ vẫn thấy siêu dữ liệu: loại mục, thời điểm, policy và kích thước',72,608,1125,42,23,C.muted);
 note(s,`THỜI LƯỢNG GỢI Ý: 60 giây.
LỜI TRÌNH BÀY: Nếu chỉ dùng phân quyền máy chủ, người chiếm được cơ sở dữ liệu hoặc máy chủ có thể vượt qua việc kiểm tra quyền để đọc dữ liệu rõ. MedABE mã hóa trước khi gửi dữ liệu ra khỏi máy nhân viên. Máy chủ lưu phong bì mã hóa và chỉ mục mù. Người dùng cần khóa thỏa chính sách mới mở được dữ liệu.
Mô hình ở đây xét kẻ có bản mã nhưng thiếu khóa, nhân viên đọc vượt phạm vi, thông đồng giữa các GID và việc mất một nút cấp khóa. Không nên mở rộng kết luận thành bảo vệ tuyệt đối trước việc chiếm toàn bộ máy đang giải mã.
Máy chủ lưu trữ không cần khóa giải mã hồ sơ. Nhưng nó vẫn giữ bí mật phục vụ định danh và xác thực, ví dụ khóa ký registry. Vì vậy câu chính xác là máy chủ không có khóa giải mã nội dung, không phải hoàn toàn không có bí mật nào.
HỎI: Đã mã hóa rồi có cần HTTPS không?
ĐÁP: Có. ABE bảo vệ nội dung, còn HTTPS bảo vệ token và các thông tin trao đổi trên đường truyền.`,['TONG_HOP_ABE_VA_HE_THONG.md: mục 1, 11, 14','LENH_DEMO_TAN_CONG_ABE.md: mục 7']);
}
// 3. Definitions.
{
 const s=slide('ABE và lựa chọn CP-ABE',{subtitle:'Attribute-Based Encryption: quyền giải mã phụ thuộc tập thuộc tính'});
 table(s,[['Dạng ABE','Policy ở đâu?','Thuộc tính ở đâu?'],['KP-ABE','Trong khóa người dùng','Gắn với bản mã'],['CP-ABE của MedABE','Gắn với bản mã','Gắn với khóa người dùng']],{y:218,h:246,widths:[340,400,400],font:27});
 txt(s,'Ví dụ chính sách',72,500,350,42,26,C.teal,true);
 txt(s,'(BacSi AND Khoa:Nhi) OR KetLuan',72,551,1120,64,39,C.ink,true);
 txt(s,'Chỉ cần thỏa một nhánh OR. Nhánh AND cần đủ mọi thuộc tính',72,622,1120,32,23,C.muted);
 note(s,`THỜI LƯỢNG GỢI Ý: 75 giây.
LỜI TRÌNH BÀY: ABE mã hóa cho một điều kiện thay vì mã hóa riêng cho từng người nhận. Với KP-ABE, người cấp khóa đặt chính sách trong khóa. Với CP-ABE, người mã hóa đặt chính sách trên bản mã, còn khóa người dùng mang các thành phần tương ứng với thuộc tính.
MedABE dùng CP-ABE vì mỗi mục khám có đối tượng đọc khác nhau. Ứng dụng dựng chính sách từ loại mục và khoa. Ví dụ, bác sĩ Nhi cần cả Role:BacSi và Khoa:Nhi để thỏa nhánh AND. Người có Role:KetLuan có thể đi qua nhánh OR còn lại.
Phân biệt thuộc tính được cấp với khóa ABE. Danh sách thuộc tính tại nút chỉ thể hiện quyền được phép xin khóa. Khi cần mở hồ sơ, thiết bị mới xin các phần khóa và ghép thành vật liệu mật mã thật.
HỎI: Sửa danh sách thuộc tính trên giao diện thành Admin có mở được không?
ĐÁP: Không. Đổi nhãn không tạo ra khóa mật mã tương ứng. Khóa gắn với tên thuộc tính qua F(attr).`,['TONG_HOP_ABE_VA_HE_THONG.md: mục 2, 4','TINH_NANG_ABE/01_THIET_BI_VA_KHOA_CUA_TOI.md: mục 2.1']);
}
// 4. Mathematical foundations, a worked LSSS example.
{
 const s=slide('Nền tảng mật mã của MedABE',{dark:true});
 txt(s,'RW15 và BLS12-381',70,184,560,48,33,C.mint,true);
 txt(s,'Lược đồ ABE kiểu Rouselakis–Waters\nCặp ghép song tuyến tính trên BLS12-381',70,246,560,105,27,C.paper);
 txt(s,'e(g₁ᵃ, g₂ᵇ) = e(g₁, g₂)ᵃᵇ',70,377,570,70,35,C.mint,true);
 txt(s,'LSSS biến policy thành bài toán\ntái tạo bí mật bằng đại số tuyến tính',70,496,550,97,27,'#CCE1DC');
 txt(s,'Ví dụ: (A AND B) OR C',690,184,520,50,31,C.paper,true);
 table(s,[['Lá','Hàng của ma trận M'],['A','(1, 1)'],['B','(0, −1)'],['C','(1, 0)']],{x:690,y:255,w:520,h:254,widths:[130,390],font:27,dark:true});
 txt(s,'A + B hoặc C tái tạo (1, 0)\nChỉ A hoặc chỉ B thì không đủ',691,546,520,85,26,'#CCE1DC');
 note(s,`THỜI LƯỢNG GỢI Ý: 100 giây.
LỜI TRÌNH BÀY: Trong mã nguồn, rw15.ts thực hiện ABE dựa trên cặp ghép BLS12-381. policy.ts phân tích biểu thức AND/OR. lsss.ts biến cây thành ma trận và giải hệ tuyến tính modulo bậc nhóm.
Xét chính sách (A AND B) OR C. Chọn vector bí mật v=(s,r). Ba hàng của ma trận tạo các phần chia sẻ: A nhận s+r, B nhận −r, C nhận s. A cộng B khôi phục s. C tự khôi phục s. Chỉ A hoặc chỉ B không đủ thông tin tái tạo theo ma trận. Ví dụ này minh họa cơ chế LSSS, không phải toàn bộ bản mã RW15. Các phần chia sẻ thực tế được bảo vệ trong các thành phần nhóm.
Điều kiện tổng quát: các hàng được chọn phải kết hợp thành vector (1,0,...,0). Hàm reconstruction tìm các hệ số tương ứng. Nếu không có nghiệm, decapsulate trả null. Nếu có nghiệm và khóa đúng GID, các cặp ghép triệt tiêu thành phần ngẫu nhiên để khôi phục bí mật KEM.
HỎI: LSSS và Shamir 2/3 có phải cùng một bước?
ĐÁP: Không. LSSS biểu diễn chính sách đọc trên bản mã. Shamir chia bí mật gốc giữa các nút cấp khóa.
Đây là bản cài đặt và mở rộng của đồ án. Không coi chứng minh của lược đồ gốc là chứng nhận an toàn cho toàn bộ ứng dụng.`,['TONG_HOP_ABE_VA_HE_THONG.md: mục 2, 3','security/src/abe/rw15.ts','security/src/abe/lsss.ts']);
}
// 5. Components and separation of duties.
{
 const s=slide('Các thành phần tham gia ABE',{subtitle:'Một cơ quan logic MED, ba nút cùng chia sẻ bí mật gốc theo ngưỡng'});
 table(s,[['Thành phần','Trách nhiệm'],['Máy nhân viên','Mã hóa, xin phần khóa, ghép khóa và giải mã'],['Registry và trạm Admin','Định danh thiết bị, đặt quyền tại từng nút'],['BenhVien, SoYTe, DienThoai','Giữ share và tự xét yêu cầu cấp khóa'],['Kho Spring và cổng liên thông','Giữ bản mã, header và siêu dữ liệu']],{h:366,widths:[490,650],font:25});
 txt(s,'Admin quản lý quyền cấp khóa. Quyền đọc vẫn cần thuộc tính lâm sàng phù hợp',72,608,1125,54,24,C.teal,true);
 note(s,`THỜI LƯỢNG GỢI Ý: 80 giây.
LỜI TRÌNH BÀY: Cần phân biệt ba vai trò. Registry xác minh thiết bị là ai và cấp chứng chỉ gắn GID với khóa công khai. Admin quyết định các thuộc tính nào được phép cấp. Các nút giữ phần bí mật và chỉ sinh phần khóa nếu yêu cầu hợp lệ. Khóa hoàn chỉnh được ghép ở máy người dùng.
Mặc dù có ba tên tổ chức, cấu hình hiện tại có một cơ quan logic MED được chia ngưỡng giữa ba nút. Không nên trình bày thành ba cơ quan ABE độc lập với ba bí mật gốc độc lập. Mã nguồn có cấu trúc hỗ trợ tên cơ quan, nhưng cấu hình đồ án dùng MED.
Kho lưu trữ Spring dùng cổng 8090, ba nút lần lượt dùng 9001, 9002, 9003. Cổng liên thông mô phỏng dùng 8095. Cổng công khai phụ huynh dùng 8096 và chỉ mở giao diện cùng /api/public/*. Kênh phụ huynh có bản bọc khóa riêng và không dùng ABE.
HỎI: Admin có mặc nhiên xem được tất cả hồ sơ không?
ĐÁP: Token quản trị tự nó không giải mã được. Nếu thiết bị Admin đồng thời được cấp thuộc tính nghiệp vụ phù hợp thì nó đọc theo các thuộc tính đó.`,['TONG_HOP_ABE_VA_HE_THONG.md: mục 5, 6, 10, 12','HUONG_DAN_APP_DIEN_THOAI.md: mục 1, 7','security/src/abe/rw15.ts']);
}
// 6. Encryption hybrid flow.
{
 const s=slide('Mã hóa lai: ABE bảo vệ khóa AES',{subtitle:'Mỗi mục phiếu khám có phong bì mã hóa và chính sách riêng'});
 point(s,1,'Sinh khóa nội dung DEK','DEK ngẫu nhiên 256 bit mã hóa nội dung bằng AES-256-GCM',{y:206});
 point(s,2,'Dùng CP-ABE để bảo vệ DEK','ABE-KEM tạo khóa bọc. AES-GCM dùng khóa đó để bọc DEK',{y:344});
 point(s,3,'Gửi phong bì lên máy chủ','Gồm header ABE, wrappedDek, IV và ciphertext. Policy là thông tin công khai',{y:482});
 note(s,`THỜI LƯỢNG GỢI Ý: 90 giây.
LỜI TRÌNH BÀY: ABE không trực tiếp mã hóa toàn bộ phiếu khám. AES xử lý nội dung vì nhanh. ABE kiểm soát việc khôi phục khóa dùng để mở nội dung.
Trong encrypt, ứng dụng sinh DEK 32 byte. encapsulate nhận khóa công khai của MED và chính sách, sinh header ABE cùng khóa KEM. AES-GCM dùng khóa KEM để bọc DEK, với chuỗi policy làm AAD. Một lần AES-GCM khác dùng DEK để mã hóa dữ liệu và ngữ cảnh bản ghi làm AAD. Ngữ cảnh gồm patientIdx, loại mục và ID bản ghi. Thay đổi policy hoặc tráo ngữ cảnh sẽ làm xác thực thất bại.
Ví dụ dữ liệu cân nặng, chẩn đoán và thông tin bác sĩ nằm trong phần nội dung mã hóa. Máy chủ vẫn thấy policy và siêu dữ liệu định tuyến. Trước khi mã hóa, tác giả ký ECDSA lên dữ liệu gắn với ID, patientIdx và loại mục. Người nhận giải mã rồi kiểm chứng chữ ký cùng chứng chỉ registry.
HỎI: Vì sao không dùng riêng AES?
ĐÁP: AES bảo vệ nội dung nhưng vẫn cần cơ chế phân phối khóa. ABE cho phép nhiều người có thuộc tính phù hợp cùng mở mà người tạo không phải liệt kê từng người nhận.
HỎI: Vì sao có hai lớp bọc?
ĐÁP: Tách khóa dữ liệu khỏi policy giúp đổi policy hoặc epoch mà giữ nguyên ciphertext nội dung.`,['TONG_HOP_ABE_VA_HE_THONG.md: mục 2.5, 3.6, 5.4','security/src/abe/rw15.ts: encrypt, encapsulate']);
}
// 7. Real policy, all OR branches retained.
{
 const s=slide('Chính sách thật của mục lâm sàng Nhi');
 txt(s,'MED:Device:<máy tạo>\nOR (MED:Role:BacSi AND MED:Khoa:Nhi)\nOR MED:Role:KetLuan\nOR MED:BG:<chỉ mục bệnh nhân>\nOR MED:Org:SoYTe',72,180,1130,230,30,C.ink,true);
 table(s,[['Thiết bị đọc thử','Kết quả với cùng bản ghi'],['Tiếp đón hoặc Bác sĩ Mắt','Không thỏa policy nếu không có nhánh OR khác'],['Bác sĩ Nhi hoặc máy tác giả','Thỏa ít nhất một nhánh nên mở được']],{y:440,h:172,widths:[500,640],font:24,rowHeights:[52,60,60]});
 txt(s,'Tên thuộc tính thực tế có hậu tố epoch. Ví dụ trên đã lược bỏ để dễ đọc',72,635,1120,29,20,C.muted);
 note(s,`THỜI LƯỢNG GỢI Ý: 100 giây.
LỜI TRÌNH BÀY: Đây là cấu trúc các nhánh do policyBranches dựng cho type=lamsang và khoa=Nhi. Máy tạo có nhánh MED:Device của chính nó. Bác sĩ Nhi dùng nhánh AND. Bác sĩ kết luận và cán bộ Sở Y tế có nhánh riêng. Nhánh BG chỉ hữu ích khi bác sĩ đã được cấp quyền cấp cứu cho đúng patientIdx.
Vì tất cả các nhánh nối bằng OR, người đóng vai sai quyền trong demo phải không có bất kỳ nhánh nào khác. Một bác sĩ Mắt vẫn mở được nếu đồng thời là máy tác giả, có KetLuan, SoYTe hoặc BG hợp lệ. Chỉ đổi tên người dùng thành hacker trên máy tác giả không tạo thành thử nghiệm vượt quyền.
policyFor thêm epoch cho mọi thuộc tính, ví dụ MED:Role:BacSi#2026W44.0. Chính sách hành chính rộng hơn và có TiepDon. Chính sách cận lâm sàng có nhánh KTV AND Khoa:XetNghiem. Mỗi mục là một bản ghi riêng nên cùng một người có thể thấy hành chính nhưng không thấy lâm sàng.
HỎI: Dòng thông báo khóa trên UI có đủ chứng minh ABE không?
ĐÁP: Chưa đủ. Cần kiểm thử gọi trực tiếp decrypt với khóa đúng và sai để loại trừ việc chỉ chặn bằng giao diện.`,['security/src/client/policy.ts: policyBranches, policyFor','LENH_DEMO_TAN_CONG_ABE.md: mục 2, 3']);
}
// 8. Threshold math.
{
 const s=slide('Sinh khóa theo ngưỡng 2 trên 3',{dark:true});
 txt(s,'2 / 3',70,180,310,150,104,C.mint,true);
 txt(s,'phần khóa của cùng thuộc tính\nvà cùng GID, từ các nút khác nhau',75,351,1100,78,28,C.paper);
 txt(s,'Kᵢ = g₂^(αᵢ) · H(GID)^(βᵢ) · F(attr)^(tᵢ)',75,461,1125,58,32,C.mint,true);
 txt(s,'K = ∏ Kᵢ^λᵢ        K′ = ∏ K′ᵢ^λᵢ',75,536,1120,60,34,C.paper);
 txt(s,'Shamir chia α, β. Lagrange ghép các phần khóa tại máy người dùng',75,620,1110,32,23,'#CCE1DC');
 txt(s,'BenhVien + SoYTe\nBenhVien + DienThoai\nSoYTe + DienThoai',660,189,540,143,31,C.paper,true);
 note(s,`THỜI LƯỢNG GỢI Ý: 110 giây.
LỜI TRÌNH BÀY: dealAuthority sinh hai bí mật alpha và beta, rồi chia mỗi bí mật bằng đa thức Shamir bậc một vì k=2. Mỗi nút giữ một cặp share alpha_i và beta_i. Đây là bước khởi tạo bằng dealer tin cậy. Chưa có DKG và chưa bảo đảm xóa bộ nhớ kiểu mật mã trong môi trường JavaScript.
Với một GID và một tên thuộc tính đã gắn epoch, nút kiểm điều kiện cấp rồi tạo phần khóa K_i như công thức, đồng thời tạo K'_i=g1^t_i. Máy người dùng lấy ít nhất hai phần từ các nút khác nhau và dùng hệ số Lagrange tại 0. Kết quả có dạng K=g2^alpha nhân H(GID)^beta nhân F(attr)^t, cùng K'=g1^t. Chương trình không cần ghép lại alpha và beta ở dạng số bí mật.
Với cặp nút x=1 và x=2, các hệ số nội suy là 2 và −1 modulo bậc nhóm. Khi đó 2f(1)−f(2)=f(0). Các cặp 1+3 và 2+3 cũng hoạt động.
HỎI: Sửa chương trình để k=1 có vượt được không?
ĐÁP: Một share không tạo được khóa đúng với khóa công khai gốc. Kiểm thử đã có tình huống ép k=1 và decrypt vẫn thất bại.
HỎI: Chạy ba tiến trình trên cùng một máy có an toàn trước việc chiếm máy đó không?
ĐÁP: Không có cách ly thực sự trước việc chiếm toàn bộ host. Cần triển khai trên các miền quản trị độc lập để có lợi ích phân tán tương ứng.`,['TONG_HOP_ABE_VA_HE_THONG.md: mục 3, 6','security/src/abe/rw15.ts: dealAuthority, partialKey, combineKey','security/src/abe/rw15.test.ts']);
}
// 9. Identity and decryption lifecycle.
{
 const s=slide('Từ định danh thiết bị đến giải mã');
 point(s,1,'Đăng ký GID và nhận chứng chỉ','Registry gắn GID với khóa công khai. Thiết bị ký PoP khi nhận quyền',{y:180});
 point(s,2,'Xin khóa theo nhu cầu mở hồ sơ','wanted chọn thuộc tính cần thiết. mayIssue kiểm quyền và epoch tại từng nút',{y:319});
 point(s,3,'Ghép khóa rồi mở phong bì','ensureKeys ghép đủ phần khóa. Giải mã tại máy và kiểm chữ ký tác giả',{y:458});
 txt(s,'Kho khóa được mã hóa. DPAPI và ràng buộc phần cứng hỗ trợ bảo vệ thiết bị',72,619,1124,35,23,C.teal,true);
 note(s,`THỜI LƯỢNG GỢI Ý: 90 giây.
LỜI TRÌNH BÀY: Thiết bị tự sinh khóa ký, gửi khóa công khai tới registry và được cấp GID cùng chứng chỉ Ed25519. Khi đổi mã cấp quyền, thiết bị ký thông điệp claim để chứng minh đang giữ khóa riêng. Nhờ đó, chỉ sao chép chứng chỉ công khai của người khác không đủ để nhận quyền.
Khi mở bản ghi, wanted chỉ chọn các thuộc tính của policy mà thiết bị có thể sở hữu, cộng nhánh Device của mình và BG còn hiệu lực. ensureKeys chỉ xin những khóa còn thiếu trong cache. Nút kiểm mayIssue, bao gồm epoch hợp lệ, thuộc tính trong holder.attrs hoặc điều kiện riêng cho Device/BG. Đủ hai phần cho một thuộc tính mới ghép được khóa.
Sau đó, ứng dụng tái tạo khóa KEM, mở DEK, giải mã dữ liệu và kiểm chứng chứng chỉ, chữ ký tác giả. Các khóa có thể được dùng lại từ cache nên không phải mỗi lần bấm mở đều hỏi nút mới.
Điểm cần nói chính xác: ClientState có thể chứa khóa ABE, và persistNow niêm phong toàn bộ trạng thái vào kho mã hóa. Không nên nói khóa tuyệt đối chỉ nằm trong RAM. Kho được bảo vệ bởi lớp khóa thiết bị và passphrase. Bản desktop còn dùng DPAPI và kiểm tra phần cứng.
HỎI: Khóa thiết bị trong UI có luôn bắt nhập lại passphrase không?
ĐÁP: Chế độ tự mở khóa có hành vi khác. session.lock bỏ qua khóa thủ công khi autoMode bật.`,['TINH_NANG_ABE/01_THIET_BI_VA_KHOA_CUA_TOI.md','security/src/client/medclient.ts: wanted, ensureKeys','app/web/src/session.ts: lock, persistNow']);
}
// 10. Collusion and integrity.
{
 const s=slide('Chống ghép khóa và sửa phong bì',{subtitle:'Hai ràng buộc trong khóa: H(GID) gắn người, F(attr) gắn thuộc tính'});
 table(s,[['Nỗ lực vượt quyền','Cơ chế ngăn việc giải mã'],['Chỉ có khóa BacSi, thiếu Khoa:Nhi','LSSS không tái tạo được bí mật KEM'],['Ghép khóa từ hai GID khác nhau','Các thành phần H(GID) không khớp'],['Đổi tên khóa BacSi thành Admin','Khóa vẫn gắn F(BacSi), không khớp F(Admin)'],['Tráo bản ghi hoặc sửa policy','AES-GCM kiểm AAD và từ chối dữ liệu sai']],{h:368,widths:[540,600],font:25});
 txt(s,'Thiếu quyền: ACCESS_DENIED. Lỗi xác thực mật mã: DECRYPT_FAIL',72,606,1125,55,25,C.teal,true);
 note(s,`THỜI LƯỢNG GỢI Ý: 95 giây.
LỜI TRÌNH BÀY: Chống thông đồng nghĩa là hai người, mỗi người không thỏa policy, không thể chỉ ghép khóa để có quyền tổng hợp. Khóa của mỗi thuộc tính chứa H(GID) nên khi giải mã theo một GID thống nhất, thành phần của GID khác làm kết quả sai. Mặc dù nhãn thuộc tính nhìn có vẻ đủ, khóa KEM thu được không đúng và AES-GCM từ chối.
F(attr) buộc vật liệu khóa vào tên thuộc tính. Trong MedABE, attr gồm cả epoch nên đổi hậu tố epoch cũng không tạo khóa mới hợp lệ. Đổi nhãn trên đối tượng JSON không thay đổi vật liệu nhóm.
AAD là dữ liệu xác thực kèm, không phải phần được mã hóa. AAD của nội dung gắn với patientIdx, type và ID. AAD của khóa bọc gắn với policy. Vì vậy không thể âm thầm chuyển phong bì của bản ghi này sang ngữ cảnh khác rồi giải mã thành công.
Phân biệt kết quả: thiếu tập khóa thỏa policy làm decrypt trả null. Khóa giả, khóa khác GID hoặc ciphertext bị sửa có thể làm decrypt ném lỗi xác thực. Ứng dụng báo hai loại sự kiện tương ứng. Giám sát không phải bằng chứng mọi lần thử ngoại tuyến đều quan sát được, vì thiết bị bị chiếm có thể không gửi báo cáo.
HỎI: Nếu một người đưa cả khóa, GID và dữ liệu rõ cho người khác thì sao?
ĐÁP: Chống thông đồng không ngăn người có quyền tự tiết lộ dữ liệu hoặc toàn bộ thông tin giải mã của mình.`,['security/src/abe/rw15.ts: partialKey, decapsulate, decrypt','security/src/abe/rw15.test.ts','TINH_NANG_ABE/04_GIAM_SAT_AN_NINH.md: mục 2, 7']);
}
// 11. Revocation.
{
 const s=slide('Thu hồi quyền bằng epoch và bọc lại khóa');
 txt(s,'MED:Khoa:Nhi#2026W44.0     thành     MED:Khoa:Nhi#2026W44.1',72,173,1135,62,30,C.teal,true);
 point(s,1,'Thu hồi ở ít nhất 2 trong 3 nút','Các nút còn được phép cấp phải ít hơn ngưỡng k=2',{y:256});
 point(s,2,'Tăng bộ đếm epoch của thuộc tính','Policy mới dùng phiên bản mới. Người bị thu hồi không xin được khóa mới',{y:374});
 point(s,3,'Người còn quyền mở và bọc lại DEK','Giữ nguyên ciphertext nội dung, thay header và phần bọc khóa',{y:492});
 note(s,`THỜI LƯỢNG GỢI Ý: 100 giây.
LỜI TRÌNH BÀY: Thu hồi ở đây có ba bước và cần đúng thứ tự. Thứ nhất, gỡ thuộc tính tại đủ số nút để người đó không ghép được khóa mới. Công thức tổng quát là n−k+1 nút. Với n=3 và k=2 thì cần ít nhất hai nút. Chỉ gỡ ở một nút còn hai nút khác cấp được.
Thứ hai, tăng counter của thuộc tính. Ví dụ minh họa dùng tuần 2026W44, từ counter 0 sang 1. Tuần và counter đều là một phần tên thuộc tính. Thứ ba, khi một người còn quyền mở bản ghi, openRecord phát hiện policy lỗi thời và gọi rewrap. Nó mở DEK rồi bọc dưới policy mới, giữ nguyên IV và ciphertext của nội dung.
Đây là lazy rewrap: chưa có người mở lại thì bản trên máy chủ vẫn có header cũ. Tăng epoch không tự động quét và sửa mọi bản ghi. Người giữ khóa cũ hoặc bản mã cũ vẫn có thể mở bản cũ. Dữ liệu rõ, DEK hay bản sao đã lấy được không thể bị thu hồi ngược.
HỎI: Khóa có tự mất khả năng giải mã khi hết tuần không?
ĐÁP: Không có đồng hồ làm khóa mật mã tự hủy. Cửa sổ retention giới hạn việc cấp lại khóa cũ ở nút. Khóa đã giữ vẫn có thể mở bản mã cũ tương ứng.
HỎI: Khóa máy trên server có đồng nghĩa thu hồi ABE không?
ĐÁP: Không. Nó chặn lấy dữ liệu từ kho nhưng không tự gỡ quyền ở các nút và không vô hiệu dữ liệu đã có.`,['TINH_NANG_ABE/03_QUAN_TRI_CAP_QUYEN.md: mục 3.4, 5','security/src/common/epoch.ts','security/src/abe/rw15.ts: rewrap']);
}
// 12. Exceptions and human approval.
{
 const s=slide('Cấp cứu và nút duyệt điện thoại');
 txt(s,'Phá vỡ kính',72,180,520,50,34,C.teal,true);
 txt(s,'Dự phòng có người duyệt',680,180,530,50,34,C.teal,true);
 txt(s,'Bác sĩ nhập lý do ít nhất 10 ký tự\nCần ít nhất 2 nút chấp nhận\nCấp khóa BG cho đúng bệnh nhân\nThời hạn cấp quyền 24 giờ\nMỗi nút phát cảnh báo CRITICAL',72,263,530,272,27,C.ink);
 txt(s,'Hai nút nhanh được hỏi trước\nThiếu phần khóa mới hỏi DienThoai\nNgười duyệt bấm Cho phép\nNút vẫn kiểm thuộc tính và epoch\nChờ duyệt khoảng 60 giây',680,263,530,272,27,C.ink);
 txt(s,'Đóng cấp cứu cần tăng epoch và bọc lại. Duyệt điện thoại không bắt buộc mọi lần xin khóa',72,594,1120,64,26,C.muted);
 note(s,`THỜI LƯỢNG GỢI Ý: 90 giây.
LỜI TRÌNH BÀY: Nhánh cấp cứu MED:BG:patientIdx đã có sẵn trong policy các mục không nhập lô, trừ hành chính. Bình thường không ai được cấp khóa này. Khi bác sĩ kích hoạt hợp lệ, ít nhất hai nút ghi nhận quyền tạm thời cho đúng bệnh nhân và mỗi nút báo BREAK_GLASS mức CRITICAL. Lý do phải đủ mười ký tự, nhưng hệ thống không xác minh tính đúng đắn của lý do. Agent có thể khóa thiết bị khi phá kính ít nhất ba bệnh nhân khác nhau trong mười lăm phút.
Hết hạn hoặc Admin đóng sớm sẽ tăng counter BG. Khóa đã cấp chỉ mất tác dụng với bản được bọc lại sang epoch mới. Không thể hứa đã hết 24 giờ là mọi bản sao ngoại tuyến tự khóa lại.
Nút DienThoai là thành viên thứ ba của ngưỡng. ensureKeys hỏi các nút không cần duyệt trước. Nếu BenhVien và SoYTe đủ phần thì không gửi yêu cầu tới DienThoai. Vì vậy đây là đường dự phòng có người duyệt. Màn Phone hiện là mô phỏng trên trạm Admin, khác với PWA phụ huynh.
HỎI: Người duyệt có nâng quyền cho người chưa được cấp thuộc tính không?
ĐÁP: Không. Sau khi duyệt, nút vẫn chạy mayIssue cho từng thuộc tính.
HỎI: Kích hoạt BG có đi qua duyệt điện thoại không?
ĐÁP: Endpoint breakglass không qua duyệt. Duyệt chỉ áp dụng khi xin phần khóa tại partials của nút yêu cầu phê duyệt.`,['TINH_NANG_ABE/02_PHA_VO_KINH.md','TINH_NANG_ABE/05_APP_DIEN_THOAI.md','security/src/client/medclient.ts: ensureKeys']);
}
// 13. Shared header and tradeoff.
{
 const s=slide('Tối ưu nhập lô bằng header ABE chung',{subtitle:'Các bản ghi cùng policy có thể chia sẻ một KeyHeader'});
 txt(s,'1',74,213,170,130,100,C.teal,true);
 txt(s,'header ABE cho một lô cùng chính sách',269,237,900,70,35,C.ink,true);
 txt(s,'Khóa bản ghi = HKDF(DEK chung, recordId)',74,383,1100,68,37,C.ink,true);
 table(s,[['Lợi ích','Đánh đổi'],['Giảm số lần chạy ABE và bọc lại header','Mở được header thì đọc được cả lô'],['Mỗi bản ghi có khóa con và chữ ký riêng','Không hỗ trợ BG theo từng bệnh nhân']],{y:477,h:164,widths:[570,570],font:24,rowHeights:[48,58,58]});
 note(s,`THỜI LƯỢNG GỢI Ý: 85 giây.
LỜI TRÌNH BÀY: Phép ghép ABE tốn kém hơn mã hóa AES. MedABE tối ưu nhập hành chính bằng cách gom các bản ghi cùng policy dưới một KeyHeader. Header giữ phần ABE và DEK chung được bọc. Bản ghi v3 chỉ cần tham chiếu headerId cùng IV và ciphertext.
Mỗi bản ghi dùng khóa con HKDF-SHA256 từ DEK chung và ID bản ghi. Trong mã nguồn, chuỗi info là medabe/rec/ cộng ID. Cách ghi trên slide là ký hiệu tóm tắt. Nhờ khóa con và AAD, tráo ciphertext giữa hai ID vẫn thất bại. Khi epoch đổi chỉ cần bọc lại một header thay vì chạy ABE trên từng bản ghi của lô.
Với một lô gồm một nghìn bản ghi cùng policy, số lần ABE để tạo header của lô là một. Đây là số lần thao tác trong thiết kế, không phải công bố thời gian benchmark của máy đang trình bày. Nếu có nhiều policy khác nhau thì phải có nhiều nhóm header tương ứng.
Đánh đổi là phạm vi giải mã theo lô. Người lấy được DEK chung có thể suy ra khóa con của mọi bản ghi thuộc header đó. Mục lâm sàng hiện lưu riêng và giữ nhánh BG theo bệnh nhân, không dùng tối ưu nhập hành chính này.
HỎI: Khóa con riêng có tạo cách ly quyền giữa các học sinh trong lô không?
ĐÁP: Không. Ai mở được header có DEK chung và suy ra khóa con từ ID công khai. Khóa con giúp tách khóa sử dụng và chống tráo, còn quyền vẫn do policy chung quyết định.`,['TONG_HOP_ABE_VA_HE_THONG.md: mục 8','security/src/abe/rw15.ts: newKeyHeader, subKey, encryptShared','security/src/client/medclient.ts: saveRecord']);
}
// 14. Evidence and demo, with a refreshed local unit test result.
{
 const s=slide('Bằng chứng kiểm thử và kịch bản demo',{subtitle:'Cùng một bản ghi, dùng người đủ quyền làm đối chứng với người sai quyền'});
 table(s,[['Tình huống thử','Kết quả mong đợi'],['Khóa đúng và đủ 2 trong 3 nút','Giải mã ra đúng nội dung gốc'],['Thiếu thuộc tính, ghép GID, giả khóa','Không giải mã được'],['Ép k=1 hoặc tráo ngữ cảnh bản ghi','Không giải mã được'],['Bọc lại sang epoch mới','Khóa mới mở được, khóa cũ bị từ chối']],{h:350,widths:[590,550],font:25});
 txt(s,'Kiểm thử lõi: 9/9 bài đạt, chạy ngày 29/10/2026',72,585,1125,40,28,C.teal,true);
 txt(s,'Demo LAN: tải bản mã qua API, so quyền trên app, đối chiếu kiểm thử mật mã',72,635,1120,30,22,C.muted);
 note(s,`THỜI LƯỢNG GỢI Ý: 95 giây.
LỜI TRÌNH BÀY: Trình tự demo gồm ba lớp bằng chứng. Đầu tiên, bác sĩ Nhi mở được chẩn đoán của hồ sơ giả. Thiết bị Tiếp đón vẫn đọc được hành chính nhưng không đọc được mục lâm sàng Nhi. Thiết bị thử sai quyền phải khác máy tác giả và không có bất kỳ nhánh OR hợp lệ nào khác.
Tiếp theo, Kali có token thiết bị lab gọi GET đúng ID và nhận HTTP 200 cùng ciphertext. Việc này chứng minh tải được bản mã không đủ để giải mã. HTTP 401 chỉ chứng minh bị lớp xác thực chặn. Cuối cùng, chạy rw15.test.ts để gọi trực tiếp các hàm mật mã, bao gồm giả thuộc tính, ghép khóa khác GID, ép k=1, sai AAD, rewrap và header chung.
Bộ kiểm thử hiện có chín bài, trong đó một bài kiểm tra cả ba cặp nút. PASS của bài tấn công nghĩa là hệ thống đã từ chối đúng như mong đợi. Các bài này sinh dữ liệu giả độc lập, không dùng bản mã vừa bắt từ LAN. Demo nhiều máy cần chạy thực tế trong buổi trình bày, không suy diễn từ unit test.
Agent và SIEM hỗ trợ quan sát ACCESS_DENIED, DECRYPT_FAIL và BREAK_GLASS. Cảm biến ARP giúp phát hiện dấu hiệu MITM sau khi duyệt baseline. Các lớp đó không thay thế kiểm thử mật mã.
HỎI: Bắt gói Wireshark có chứng minh ABE an toàn không?
ĐÁP: Chỉ thấy ciphertext mới chứng minh nội dung đang mã hóa trên đường truyền. Cần thêm đối chứng giải mã với khóa đúng/sai. Chín bài đạt cũng không thay thế kiểm toán an toàn toàn hệ thống.`,['LENH_DEMO_TAN_CONG_ABE.md','LENH_DEMO_KALI_NGHE_LEN.md','security/src/abe/rw15.test.ts']);
}
// 15. Precise scope and conclusion.
{
 const s=slide('Phạm vi bảo vệ và giới hạn',{dark:true});
 txt(s,'ABE kiểm soát quyền đọc\nqua khóa thỏa policy',72,185,1100,110,48,C.mint,true);
 txt(s,'Quyền ghi và máy trạm',72,347,520,44,29,C.paper,true);
 txt(s,'ABE chưa kiểm soát quyền ghi\nMáy đang mở khóa vẫn có thể lộ dữ liệu',72,403,530,94,26,'#CCE1DC');
 txt(s,'Thu hồi và các bản sao cũ',682,347,525,44,29,C.paper,true);
 txt(s,'Hiệu lực với bản đã bọc lại\nDữ liệu đã đọc không thể lấy lại',682,403,525,94,26,'#CCE1DC');
 txt(s,'Kênh phụ huynh',72,532,520,44,29,C.paper,true);
 txt(s,'Bọc khóa riêng bằng họ tên + CCCD\nKhông nằm trong cơ chế ABE',72,585,530,80,26,'#CCE1DC');
 txt(s,'Điều kiện triển khai',682,532,525,44,29,C.paper,true);
 txt(s,'Cần HTTPS, cách ly các nút\nvà kiểm toán bản cài đặt mật mã',682,585,525,80,26,'#CCE1DC');
 note(s,`THỜI LƯỢNG GỢI Ý: 90 giây và dành thời gian trao đổi.
LỜI TRÌNH BÀY: Kết quả chính của đồ án là chuyển quyền đọc từng mục hồ sơ thành điều kiện mật mã. CP-ABE bảo vệ khóa nội dung. AES-GCM bảo vệ dữ liệu và tính toàn vẹn theo ngữ cảnh. Ngưỡng hai trên ba giảm sự phụ thuộc vào một nút khi các nút được cách ly phù hợp. GID giúp chống ghép khóa, epoch hỗ trợ thay đổi quyền trong tương lai thông qua bọc lại.
Giới hạn cần nêu đúng là ABE hiện chưa bảo vệ quyền ghi bằng mật mã vai trò. Khi endpoint bị chiếm lúc mở khóa, kẻ tấn công có thể lấy dữ liệu rõ hoặc khóa đang dùng. Thu hồi không xóa được thông tin người có quyền đã sao chép.
Kênh phụ huynh hiện dùng scrypt từ CCCD và họ tên chuẩn hóa để suy khóa bọc riêng. Tên không phải bí mật. Người có bản sao dữ liệu cổng có thể đoán ngoại tuyến, không chịu giới hạn tốc độ online. Vì cùng DEK có thêm đường bọc khác, mức bảo vệ tổng thể phải xét cả đường đó, không chỉ ABE. Các tài liệu tổng hợp cũ còn ghi ngày sinh, nhưng parent.ts hiện dùng họ tên.
Hệ thống demo LAN còn HTTP nên token có thể bị nghe lén. Ba nút cùng host không chịu được việc chiếm toàn bộ host. Dealer khởi tạo là bên tin cậy, chưa có DKG. BLS12-381 không phải mật mã hậu lượng tử và bản cài đặt chưa kiểm toán độc lập.
KẾT THÚC: Em đã phân biệt phần ABE thực sự bảo vệ, các lớp hỗ trợ vận hành và những giới hạn cần cải thiện trước triển khai thực tế.
CÂU HỎI ÔN TẬP: Vì sao cần ABE cùng AES? Vì sao khóa gắn GID? Hai trên ba là ngưỡng cấp khóa hay hai thuộc tính trong policy? Vì sao chỉ bump epoch chưa thu hồi ngay? Kênh phụ huynh có dùng ABE không?`,['TONG_HOP_ABE_VA_HE_THONG.md: mục 14','HUONG_DAN_APP_DIEN_THOAI.md: mục 5, 7','security/src/client/parent.ts','TINH_NANG_ABE/03_QUAN_TRI_CAP_QUYEN.md']);
}

await fs.writeFile(path.join(BUILD,'outline.json'),JSON.stringify(manifest,null,2));
for(const [i,s] of P.slides.items.entries()){
 const filename=path.join(BUILD,'renders',`slide-${String(i+1).padStart(2,'0')}.png`);
 await fs.writeFile(filename,new Uint8Array(await (await P.export({slide:s,format:'png',scale:1})).arrayBuffer()));
 const layout=await s.export({format:'layout'});
 await fs.writeFile(filename.replace('.png','.json'),await layout.text());
 console.log(`Rendered ${i+1}/15`);
}
await fs.writeFile(path.join(BUILD,'montage.webp'),new Uint8Array(await (await P.export({format:'webp',montage:true})).arrayBuffer()));
const candidate=path.join(BUILD,'candidate.pptx');
await(await PresentationFile.exportPptx(P)).save(candidate);
console.log('Candidate exported');
if(process.argv.includes('--draft-only'))process.exit(0);
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL,'container_tools/artifact_tool_utils.mjs')).href);
const finalPath=path.join(OUT,'MedABE_ABE_15_trang_thuyet_trinh.pptx');
const result=await finalizePresentation({workspaceDir:BASE,candidatePath:candidate,finalPath,pythonExecutable:PYTHON,
 integrityValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_package_integrity.py'),
 layoutValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_layout_geometry.py'),
 layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit',...[2,3,4,5,7,10,13,14].flatMap(n=>['--require-native-table-slide',String(n)])],
 explicitTotalSlideCount:15,requiredNativeTableOwnerSlides:[2,3,4,5,7,10,13,14],requiredNativeChartOwnerSlides:[],
 fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,
 receiptPath:path.join(BUILD,'validation-final.json')});
console.log(JSON.stringify(result));
