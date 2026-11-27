package fr.silencio.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Silencio sur Android. Au lancement (demarrage.py) : télécharge la dernière version depuis le dépôt GitHub si elle a
 * changé, démarre le serveur de Silencio sur le téléphone, et l'affiche en plein écran. Pendant que l'application
 * tourne, les notifications de Silencio (watchlist disponible, sorties, récap du mois) deviennent des notifications
 * Android.
 */
public class MainActivity extends Activity {
    private static final int FOND = Color.parseColor("#0d0d12");
    private static final int CHOIX_FICHIER = 7;
    private static final String CANAL = "silencio";
    private final Handler ui = new Handler(Looper.getMainLooper());
    private WebView web;
    private LinearLayout accueil;
    private TextView message;
    private ProgressBar roue;
    private Button reessayer;
    private volatile PyObject module;
    private volatile boolean pret = false;
    private String base = "";
    private String lienEnAttente = "";
    private ValueCallback<Uri[]> rappelFichier;
    private double notifsDepuis = System.currentTimeMillis() / 1000.0;
    private int numeroNotif = 1;

    @Override
    protected void onCreate(Bundle etat) {
        super.onCreate(etat);
        getWindow().setStatusBarColor(FOND);
        getWindow().setNavigationBarColor(FOND);

        FrameLayout racine = new FrameLayout(this);
        racine.setBackgroundColor(FOND);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " SilencioApp/" + BuildConfig.VERSION_CODE);
        web.setBackgroundColor(FOND);
        web.setWebChromeClient(new WebChromeClient() {
            @Override   // <input type="file"> : imports Letterboxd / IMDb
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> rappel, FileChooserParams p) {
                if (rappelFichier != null) rappelFichier.onReceiveValue(null);
                rappelFichier = rappel;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Choisir un fichier"), CHOIX_FICHIER);
                } catch (Exception e) {
                    rappelFichier = null;
                    return false;
                }
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) erreur("Silencio ne répond plus.");
            }

            @Override   // les liens externes (IMDb, Letterboxd, e-mail…) s'ouvrent hors de l'application
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                String u = r.getUrl().toString();
                if (u.startsWith("http://127.0.0.1") || u.contains("themoviedb.org/authenticate")
                        || u.contains("themoviedb.org/login") || u.contains("themoviedb.org/signup")) return false;
                ouvrirAilleurs(u);
                return true;
            }
        });
        // exports (fichiers .csv / .json) : ouverts par le navigateur du téléphone, qui les enregistre
        web.setDownloadListener((url, agent, disposition, type, taille) -> ouvrirAilleurs(url));
        web.setVisibility(View.INVISIBLE);
        racine.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        accueil = new LinearLayout(this);
        accueil.setOrientation(LinearLayout.VERTICAL);
        accueil.setGravity(Gravity.CENTER);
        accueil.setPadding(60, 60, 60, 60);
        ImageView icone = new ImageView(this);
        icone.setImageResource(R.drawable.icone);
        accueil.addView(icone, new LinearLayout.LayoutParams(240, 240));
        TextView titre = new TextView(this);
        titre.setText("Silencio");
        titre.setTextColor(Color.parseColor("#eeedf3"));
        titre.setTextSize(32);
        titre.setTypeface(Typeface.create(Typeface.SERIF, Typeface.ITALIC));
        titre.setGravity(Gravity.CENTER);
        titre.setPadding(0, 30, 0, 30);
        accueil.addView(titre);
        roue = new ProgressBar(this);
        accueil.addView(roue);
        message = new TextView(this);
        message.setTextColor(Color.parseColor("#a7a5b6"));
        message.setTextSize(15);
        message.setGravity(Gravity.CENTER);
        message.setPadding(0, 30, 0, 30);
        message.setText("Démarrage…");
        accueil.addView(message);
        reessayer = new Button(this);
        reessayer.setText("Réessayer");
        reessayer.setVisibility(View.GONE);
        reessayer.setOnClickListener(v -> lancer());
        accueil.addView(reessayer);
        racine.addView(accueil, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(racine);

        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel c = new NotificationChannel(CANAL, "Silencio", NotificationManager.IMPORTANCE_DEFAULT);
            c.setDescription("Watchlist disponible, sorties de tes favoris, récap du mois");
            ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(c);
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        lireIntention(getIntent());
        lancer();
    }

    private void ouvrirAilleurs(String u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
        } catch (Exception ignore) {
        }
    }

    /** Ouvert depuis une notification (lien « #/… ») ou par « Partager » un lien de film. */
    private void lireIntention(Intent i) {
        if (i == null) return;
        String lien = i.getStringExtra("lien");
        if (lien != null && !lien.isEmpty()) {
            aller(lien);
            return;
        }
        if (Intent.ACTION_SEND.equals(i.getAction()) || (Intent.ACTION_VIEW.equals(i.getAction()) && i.getData() != null)) {
            final String texte = Intent.ACTION_VIEW.equals(i.getAction()) ? i.getDataString() : i.getStringExtra(Intent.EXTRA_TEXT);
            new Thread(() -> {
                try {
                    while (module == null || !pret) Thread.sleep(200);
                    String l = module.callAttr("lien_partage", texte).toString();
                    if (!l.isEmpty()) ui.post(() -> aller(l));
                } catch (Throwable ignore) {
                }
            }).start();
        }
    }

    private void aller(String lien) {
        if (pret && !base.isEmpty()) web.loadUrl(base + lien);
        else lienEnAttente = lien;
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        lireIntention(i);
    }

    private void lancer() {
        pret = false;
        accueil.setVisibility(View.VISIBLE);
        roue.setVisibility(View.VISIBLE);
        reessayer.setVisibility(View.GONE);
        web.setVisibility(View.INVISIBLE);
        new Thread(() -> {
            try {
                if (!Python.isStarted()) Python.start(new AndroidPlatform(this));
                module = Python.getInstance().getModule("demarrage");
                ui.post(suivi);
                String url = module.callAttr("demarrer", getFilesDir().getAbsolutePath(), BuildConfig.DEPOT).toString();
                ui.post(() -> {
                    base = url;
                    pret = true;
                    web.loadUrl(url + lienEnAttente);
                    lienEnAttente = "";
                    web.setVisibility(View.VISIBLE);
                    accueil.setVisibility(View.GONE);
                });
                ui.removeCallbacks(notifs);
                ui.postDelayed(notifs, 20000);
                proposerNouvelleAppli();
            } catch (Throwable t) {
                String m = t.getMessage() == null ? t.toString() : t.getMessage();
                int i = m.lastIndexOf("Error: ");
                erreur(i >= 0 ? m.substring(i + 7) : m);
            }
        }).start();
    }

    /** Toutes les minutes : les nouvelles notifications de Silencio deviennent des notifications Android. */
    private final Runnable notifs = new Runnable() {
        @Override
        public void run() {
            if (module == null) return;
            new Thread(() -> {
                try {
                    JSONArray l = new JSONArray(module.callAttr("notifications", notifsDepuis).toString());
                    for (int k = 0; k < l.length(); k++) {
                        JSONObject n = l.getJSONObject(k);
                        notifsDepuis = Math.max(notifsDepuis, n.optDouble("date", notifsDepuis));
                        montrer(n.optString("titre"), n.optString("texte"), n.optString("lien"));
                    }
                } catch (Throwable ignore) {
                }
            }).start();
            ui.postDelayed(this, 60000);
        }
    };

    private void montrer(String titre, String texte, String lien) {
        Intent i = new Intent(this, MainActivity.class);
        i.putExtra("lien", lien);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, numeroNotif, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CANAL) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_premier_plan).setContentTitle(titre).setContentText(texte).setAutoCancel(true).setContentIntent(pi);
        try {
            ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(numeroNotif++, b.build());
        } catch (SecurityException ignore) {
        }
    }

    private boolean appliProposee = false;

    private void proposerNouvelleAppli() {
        if (appliProposee) return;
        appliProposee = true;
        String apk = "";
        try {
            apk = module.callAttr("nouvelle_appli", BuildConfig.DEPOT, BuildConfig.VERSION_CODE).toString();
        } catch (Throwable ignore) {
        }
        if (apk.isEmpty()) return;
        final String lien = apk;
        ui.post(() -> {
            if (isFinishing()) return;
            new AlertDialog.Builder(this)
                    .setTitle("Nouvelle version de l'application")
                    .setMessage("Une nouvelle version de Silencio est prête. Télécharge-la puis ouvre le fichier : "
                            + "elle s'installe par-dessus celle-ci (ton profil est gardé).")
                    .setPositiveButton("Télécharger", (d, w) -> ouvrirAilleurs(lien))
                    .setNegativeButton("Plus tard", null)
                    .show();
        });
    }

    private final Runnable suivi = new Runnable() {
        @Override
        public void run() {
            if (pret || module == null) return;
            try {
                message.setText(module.callAttr("message").toString());
            } catch (Throwable ignore) {
            }
            ui.postDelayed(this, 300);
        }
    };

    private void erreur(String texte) {
        ui.post(() -> {
            pret = true;
            web.setVisibility(View.INVISIBLE);
            accueil.setVisibility(View.VISIBLE);
            roue.setVisibility(View.GONE);
            message.setText(texte);
            reessayer.setVisibility(View.VISIBLE);
        });
    }

    @Override
    protected void onActivityResult(int code, int resultat, Intent donnees) {
        if (code == CHOIX_FICHIER && rappelFichier != null) {
            Uri u = (resultat == RESULT_OK && donnees != null) ? donnees.getData() : null;
            rappelFichier.onReceiveValue(u == null ? null : new Uri[]{u});
            rappelFichier = null;
            return;
        }
        super.onActivityResult(code, resultat, donnees);
    }

    @Override
    public void onBackPressed() {
        if (web.getVisibility() == View.VISIBLE && web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }
}
