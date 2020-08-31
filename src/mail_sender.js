
const mailer=require("nodemailer");
const transporter=mailer.createTransport(
{ 
	host: "smtp.zoho.com", port: 465, secure: true,
	auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
});

module.exports=function(address,subject,textContent,htmlContent)
{
	const mailOptions=
	{ 
		from: process.env.MAIL_USER,
		replyTo: "support@textshare.com", to: address
	};
	if (subject) mailOptions.subject=subject;
	if (textContent) mailOptions.text=textContent;
	if (htmlContent) mailOptions.html=htmlContent;
	return transporter.sendMail(mailOptions);
}
